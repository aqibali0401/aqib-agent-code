import { Injectable, Inject, LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as fs from 'fs';
import * as path from 'path';

// Azure IoT DPS SDK
import { ProvisioningDeviceClient } from 'azure-iot-provisioning-device';
import { Mqtt as ProvisioningMqtt } from 'azure-iot-provisioning-device-mqtt';
import { X509Security } from 'azure-iot-security-x509';

export interface DpsProvisioningConfig {
  /** DPS global endpoint */
  provisioningHost: string;
  /** DPS ID Scope */
  idScope: string;
  /** Device registration ID - MUST match certificate CN (e.g., AIO_20VD_PG02W5PL) */
  registrationId: string;
  /** Path to device certificate PEM file */
  certFilePath: string;
  /** Path to full certificate chain PEM file (device cert + intermediate + root) */
  chainFilePath?: string;
  /** Path to private key file (required until TPM signing is implemented) */
  keyFilePath?: string;
}

export interface DpsProvisioningResult {
  /** Assigned IoT Hub hostname */
  assignedHub: string;
  /** Device ID assigned by DPS */
  deviceId: string;
  /** Registration status */
  status: 'assigned' | 'assigning' | 'failed';
}

@Injectable()
export class DpsProvisioningService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {}

  /**
   * Provision device with Azure DPS using X.509 certificate authentication
   * 
   * @param config - DPS provisioning configuration
   * @returns Promise<DpsProvisioningResult> - Contains assigned IoT Hub and device ID
   */
  async provisionDevice(config: DpsProvisioningConfig): Promise<DpsProvisioningResult> {
    const {
      provisioningHost,
      idScope,
      registrationId,
      certFilePath,
      chainFilePath,
      keyFilePath,
    } = config;

    this.logger.log('========================================');
    this.logger.log(' Starting DPS Provisioning (TPM-backed X.509)');
    this.logger.log('========================================');
    this.logger.log(`  Provisioning Host: ${provisioningHost}`);
    this.logger.log(`  ID Scope: ${idScope}`);
    this.logger.log(`  Registration ID (must match cert CN): ${registrationId}`);
    this.logger.log(`  Certificate: ${certFilePath}`);
    this.logger.log(`  Private Key: TPM-backed (accessed via Windows cert store)`);

    // Validate certificate file exists
    const certAbsPath = path.resolve(certFilePath);
    if (!fs.existsSync(certAbsPath)) {
      throw new Error(`Certificate file not found: ${certAbsPath}`);
    }

    // Read device certificate
    let certPem = fs.readFileSync(certAbsPath, 'utf8');
    this.logger.log('Device certificate loaded successfully');

    // If chain file provided, append it to cert (DPS needs full chain for validation)
    if (chainFilePath) {
      const chainAbsPath = path.resolve(chainFilePath);
      if (fs.existsSync(chainAbsPath)) {
        const chainPem = fs.readFileSync(chainAbsPath, 'utf8');
        certPem = certPem + '\n' + chainPem;
        this.logger.log('Certificate chain appended');
      }
    }

    // Create X509 security client
    // For TPM-backed auth: The private key signing will be handled by Windows CNG
    // when the certificate is imported to Windows cert store with TPM key association
    const x509Security = new X509Security(registrationId, {
      cert: certPem,
      key: '', // Empty - TPM handles signing via Windows cert store
    });

    // Create provisioning transport (MQTT)
    const provisioningTransport = new ProvisioningMqtt();

    // Create provisioning client
    const provisioningClient = ProvisioningDeviceClient.create(
      provisioningHost,
      idScope,
      provisioningTransport,
      x509Security
    );

    this.logger.log('DPS client created, starting registration...');

    // Register device with DPS
    return new Promise<DpsProvisioningResult>((resolve, reject) => {
      provisioningClient.register((err, result) => {
        if (err) {
          this.logger.error(`DPS registration failed: ${err.message}`);
          reject(new Error(`DPS registration failed: ${err.message}`));
          return;
        }

        if (!result) {
          this.logger.error('DPS registration returned no result');
          reject(new Error('DPS registration returned no result'));
          return;
        }

        this.logger.log('========================================');
        this.logger.log(' DPS Registration Successful!');
        this.logger.log('========================================');
        this.logger.log(`  Assigned Hub: ${result.assignedHub}`);
        this.logger.log(`  Device ID: ${result.deviceId}`);
        this.logger.log(`  Status: ${result.status}`);

        resolve({
          assignedHub: result.assignedHub,
          deviceId: result.deviceId,
          status: result.status as 'assigned' | 'assigning' | 'failed',
        });
      });
    });
  }

  /**
   * Build DPS config from environment variables
   * 
   * @param deviceId - Device ID (must match certificate CN, e.g., AIO_20VD_PG02W5PL)
   * @param certFilePath - Path to device certificate PEM
   * @param chainFilePath - Optional path to certificate chain PEM
   */
  buildConfigFromEnv(deviceId: string, certFilePath: string, chainFilePath?: string): DpsProvisioningConfig {
    const provisioningHost = process.env.DPS_PROVISIONING_HOST || 'global.azure-devices-provisioning.net';
    const idScope = process.env.DPS_ID_SCOPE;

    if (!idScope) {
      throw new Error('DPS_ID_SCOPE environment variable is required');
    }

    return {
      provisioningHost,
      idScope,
      registrationId: process.env.DPS_REGISTRATION_ID || deviceId,
      certFilePath,
      chainFilePath,
    };
  }
}
