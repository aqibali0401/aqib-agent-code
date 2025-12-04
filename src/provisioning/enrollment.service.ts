import { Injectable, Inject, LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface EnrollmentOptions {
  deviceId: string;
  model: string;
  serial: string;
  csrPath: string;
  certPath: string;
  chainPath?: string;
}

interface EnrollmentResponsePayload {
  deviceCertPem: string;
  deviceKeyPem?: string;
  deviceFullchainPem?: string;
  caChainPem?: string;
}

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {}

  // @todo -- will check which enrollment service is being used and return the correct url
  private get enrollmentUrl(): string {
    const url = process.env.ENROLLMENT_URL;
    if (!url) {
      throw new Error('ENROLLMENT_URL is not configured');
    }
    return url.replace(/\/$/, '');
  }

  private get enrollmentToken(): string {
    const token = process.env.ENROLLMENT_TOKEN;
    if (!token) {
      throw new Error('ENROLLMENT_TOKEN is not configured');
    }
    return token;
  }

  async enrollDeviceCertificate(options: EnrollmentOptions): Promise<void> {
    const { deviceId, model, serial, csrPath, certPath, chainPath } = options;

    const csrAbsolute = path.resolve(csrPath);
    const certAbsolute = path.resolve(certPath);
    const chainAbsolute = chainPath ? path.resolve(chainPath) : undefined;

    // Note: We do NOT handle X509_KEY_FILE here because TPM-backed keys stay in hardware
    // If the enrollment service returns deviceKeyPem, it's a security concern and should be flagged

    this.logger.log(
      `Submitting CSR for device ${deviceId} to enrollment service (${this.enrollmentUrl})`
    );

    const csrPem = await fs.readFile(csrAbsolute, 'utf8');

    const response = await axios.post<EnrollmentResponsePayload>(
      `${this.enrollmentUrl}/api/enroll`,
      {
        deviceId,
        model,
        serial,
        csrPem,
      },
      {
        headers: {
          Authorization: `Bearer ${this.enrollmentToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 120_000,
      }
    );

    if (!response.data?.deviceCertPem) {
      throw new Error('Enrollment service did not return a device certificate');
    }

    await fs.mkdir(path.dirname(certAbsolute), { recursive: true });
    await fs.writeFile(certAbsolute, response.data.deviceCertPem, 'utf8');
    this.logger.log(`Device certificate written to ${certAbsolute}`);

    // SECURITY WARNING: If the enrollment service returns a private key, it's a security issue
    // TPM-backed keys should NEVER be exported or transmitted
    if (response.data.deviceKeyPem) {
      this.logger.error(
        '⚠️ SECURITY ALERT: Enrollment service returned a private key (deviceKeyPem). ' +
        'This violates TPM security principles. Private keys should remain in TPM hardware and never be transmitted. ' +
        'Please update your enrollment service to NOT return private keys for TPM-backed CSRs.'
      );
      // We intentionally do NOT save the key even if returned
    }

    const chainPem =
      response.data.deviceFullchainPem ?? response.data.caChainPem;

    if (chainAbsolute && chainPem) {
      await fs.mkdir(path.dirname(chainAbsolute), { recursive: true });
      await fs.writeFile(chainAbsolute, chainPem, 'utf8');
      this.logger.log(`CA chain written to ${chainAbsolute}`);
    }
  }
}

