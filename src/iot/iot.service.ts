import {
  Injectable,
  OnModuleInit,
  Inject,
  LoggerService,
} from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Client, Message } from 'azure-iot-device';
import { MqttWs as DeviceMqttWs } from 'azure-iot-device-mqtt';
import { X509Security } from 'azure-iot-security-x509';
import {
  ProvisioningDeviceClient,
  RegistrationResult,
} from 'azure-iot-provisioning-device';
import { MqttWs as DpsMqtt } from 'azure-iot-provisioning-device-mqtt';
import * as fs from 'fs';
import * as path from 'path';
import { DEVICE_TYPE, EVENT_TYPE } from '../constants/app.constants';
import {
  getHostDeviceSnapshot,
  HostDeviceSnapshot,
} from '../utils/device-info';
import { formatDeviceId } from '../utils/device-id';

type TwinDesiredProperties = {
  telemetryInterval?: number;
  firstTimeRegistration?: boolean;
};
type TwinProperties = {
  desired: TwinDesiredProperties;
  reported: TwinDesiredProperties;
};

const provisioningHost =
  process.env.PROVISIONING_HOST || 'global.azure-devices-provisioning.net';
const idScope = process.env.PROVISIONING_IDSCOPE as string;
const groupSymmetricKey = process.env
  .PROVISIONING_GROUP_SYMMETRIC_KEY as string;
const x509CertFile = process.env.X509_CERT_FILE as string;
const x509KeyFile = process.env.X509_KEY_FILE as string;
const x509Passphrase = process.env.X509_PASSPHRASE as string;
const appVersion = process.env.APP_VERSION as string;

@Injectable()
export class IoTService implements OnModuleInit {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {}


  async onModuleInit() {
    // Intentionally left blank to delay device initialization until after app start
  }

  async initializeAfterAppStart() {
    try {
      const snapshot = await getHostDeviceSnapshot();
      const model = snapshot.system.model || 'MODEL';
      const serial =
        snapshot.system.serial ||
        snapshot.system.uuid ||
        'SERIAL';
      
      // For X.509: deviceId is generated from system info and MUST match certificate CN
      const deviceId = formatDeviceId(DEVICE_TYPE, model, serial);
      this.logger.log(`Using device ID: ${deviceId}`);
      
      snapshot.registrationId = deviceId;
      await this.openAndInitDevice(deviceId, snapshot);
    } catch (err) {
      this.logger.error('Failed to initialize IoT device on startup:', err);
    }
  }

  async registerNewIotDevice(
    deviceId: string
  ): Promise<{ client: Client; registrationResult: RegistrationResult }> {
    if (!idScope) throw new Error('Missing PROVISIONING_IDSCOPE');
    if (!x509CertFile) throw new Error('Missing X509_CERT_FILE');
    if (!x509KeyFile) throw new Error('Missing X509_KEY_FILE');

    // Read X.509 certificate and private key
    let cert: string, key: string;
    try {
      const certPath = path.resolve(x509CertFile);
      const keyPath = path.resolve(x509KeyFile);

      cert = fs.readFileSync(certPath, 'utf8');
      key = fs.readFileSync(keyPath, 'utf8');

      this.logger.log(`Certificate loaded from: ${certPath}`);
      this.logger.log(`Private key loaded from: ${keyPath}`);
    } catch (error) {
      this.logger.error('Failed to load X.509 certificate or key:', error);
      throw error;
    }

    // Create X509 certificate object with cert and key
    const x509Certificate = {
      cert: cert,
      key: key,
      passphrase: x509Passphrase,
    };

    const securityClient = new X509Security(deviceId, x509Certificate);

    this.logger.log('X509Security client created successfully');

    const dpsTransport = new DpsMqtt();

    const provisioningClient = ProvisioningDeviceClient.create(
      provisioningHost,
      idScope,
      dpsTransport,
      securityClient
    );

    this.logger.log('Provisioning client created successfully');

    this.logger.log('Starting DPS registration...');
    const registrationResult = await new Promise<RegistrationResult>(
      (resolve, reject) => {
        // Set a timeout for registration (60 seconds)
        const timeout = setTimeout(() => {
          this.logger.error('DPS registration timed out after 60 seconds');
          reject(new Error('DPS registration timeout'));
        }, 60000);

        provisioningClient.register((err, result) => {
          clearTimeout(timeout);
          if (err) {
            this.logger.error('DPS registration failed:', err);
            this.logger.error('Error message:', err.message || 'No error message');
            this.logger.error('Error code:', (err as any).code || 'No error code');
            return reject(err);
          }
          if (!result) {
            this.logger.error('Registration result is undefined');
            return reject(new Error('Registration result is undefined'));
          }
          this.logger.log('DPS registration successful!');
          resolve(result);
        });
      }
    );

    this.logger.log(`DeviceId: ${registrationResult.deviceId}`);

    const transport = DeviceMqttWs;
    const deviceConnectionString = `HostName=${registrationResult.assignedHub};DeviceId=${registrationResult.deviceId};x509=true`;
    const client = Client.fromConnectionString(deviceConnectionString, transport);
    
    // Set X.509 certificate options for the device client
    client.setOptions({
      cert: cert,
      key: key,
      passphrase: x509Passphrase,
    });

    return { client, registrationResult };
  }

  async openAndInitDevice(deviceId: string, deviceInfo: HostDeviceSnapshot) {
    const { client, registrationResult } = await this.registerNewIotDevice(
      deviceId
    );
    await client.open();
    this.logger.log(`Device connected to IoT Hub: ${registrationResult.assignedHub}`);
    this.logger.log(`Device ID: ${registrationResult.deviceId}`);
    this.applyRemoteActions(client);
    await this.readDeviceUpdates(client, deviceInfo);
    this.receiveMessages(client);
  }

  private async sendTelemetry(client: Client, data: Record<string, unknown>) {
    const message = new Message(JSON.stringify(data));
    await client.sendEvent(message);
  }

  private async readDeviceUpdates(
    client: Client,
    deviceInfo: HostDeviceSnapshot
  ) {
    const twin = await client.getTwin();
    const properties = twin.properties as unknown as TwinProperties;
    const isDesiredFirstTimeRegistration =
      properties.desired.firstTimeRegistration;

    const isReportedFirstTimeRegistration =
      properties.reported.firstTimeRegistration === undefined ||
      properties.reported.firstTimeRegistration === true
        ? true
        : false;

    if (isDesiredFirstTimeRegistration && isReportedFirstTimeRegistration) {
      await this.sendTelemetry(client, {
        eventType: EVENT_TYPE.NEW_DEVICE_REGISTRATION,
        deviceId: deviceInfo.registrationId,
        serial: deviceInfo.system.serial,
        name: deviceInfo.hostname,
        model: deviceInfo.system.model,
        uptime: deviceInfo.uptime * 1000, // Convert to milliseconds
        modelNumber: deviceInfo.system.model,
        serialNo: deviceInfo.system.serial,
      });

      await new Promise<void>((resolve) => {
        twin.properties.reported.update({ firstTimeRegistration: false }, () =>
          resolve()
        );
      });
      this.logger.log('New device event triggered');
    }
  }

  private receiveMessages(client: Client) {
    client.on('message', async (msg) => {
      try {
        const msgBuffer = msg.data;
        const msgStringified = msgBuffer.toString();
        this.logger.log(`Received message from IoT Hub: ${msgStringified}`);
        await client.complete(msg);
      } catch (err) {
        this.logger.error('Error completing message:', err);
      }
    });
  }

  private applyRemoteActions(client: Client) {
    client.onDeviceMethod('reboot', async (request, response) => {
      try {
        this.logger.log('Reboot called');
        await response.send(200, 'Rebooting device...');
      } catch (err) {
        this.logger.error('Error responding to reboot method');
      }
    });

    client.onDeviceMethod('upgrade', async (request, response) => {
      if (!request?.payload?.version) {
        return response.send(403, 'Upgrade version missing');
      }
      const newVersion = request.payload.version;
      try {
        await response.send(
          200,
          `Upgrading device to version ${newVersion}...`
        );
        // this.startSendingTelemetry(client, telemetryInterval);
      } catch (err) {
        this.logger.error('Error responding to upgrade method');
      }
    });
  }
}
