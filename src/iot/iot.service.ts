import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, Message } from 'azure-iot-device';
import { MqttWs as DeviceMqttWs } from 'azure-iot-device-mqtt';
import { SymmetricKeySecurityClient } from 'azure-iot-security-symmetric-key';
import {
  ProvisioningDeviceClient,
  RegistrationResult,
} from 'azure-iot-provisioning-device';
import { MqttWs as DpsMqtt } from 'azure-iot-provisioning-device-mqtt';
import * as crypto from 'crypto';
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

@Injectable()
export class IoTService implements OnModuleInit {
  private readonly logger = new Logger(IoTService.name);

  private deriveDeviceKey(groupKey: string, deviceId: string): string {
    const key = Buffer.from(groupKey, 'base64');
    const hmac = crypto.createHmac('sha256', new Uint8Array(key));
    hmac.update(deviceId, 'utf8');
    return hmac.digest('base64');
  }

  async onModuleInit() {
    try {
      const snapshot = await getHostDeviceSnapshot();
      const model = snapshot.system.model || 'MODEL';
      const serial = snapshot.system.serial || snapshot.system.uuid || 'SERIAL';
      const deviceId = formatDeviceId(DEVICE_TYPE, model, serial);
      snapshot.registrationId = deviceId;
      await this.openAndInitDevice(deviceId, snapshot);
      this.logger.log(`IoT device initialized on startup: ${deviceId}`);
    } catch (err) {
      console.log(err);
      this.logger.error('Failed to initialize IoT device on startup');
    }
  }

  async registerNewIotDevice(
    deviceId: string
  ): Promise<{ client: Client; registrationResult: RegistrationResult }> {
    if (!idScope) throw new Error('Missing PROVISIONING_IDSCOPE');
    if (!groupSymmetricKey)
      throw new Error('Missing PROVISIONING_GROUP_SYMMETRIC_KEY');

    const deviceSymmetricKey = this.deriveDeviceKey(
      groupSymmetricKey,
      deviceId
    );
    const securityClient: SymmetricKeySecurityClient =
      new SymmetricKeySecurityClient(deviceId, deviceSymmetricKey);

    const dpsTransport = new DpsMqtt();
    const provisioningClient = ProvisioningDeviceClient.create(
      provisioningHost,
      idScope,
      dpsTransport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      securityClient as any
    );

    const registrationResult = await new Promise<RegistrationResult>(
      (resolve, reject) => {
        provisioningClient.register((err, result) => {
          if (err) return reject(err);
          if (!result)
            return reject(new Error('Registration result is undefined'));
          resolve(result);
        });
      }
    );

    this.logger.log('Registration succeeded');
    this.logger.log(`Assigned Hub: ${registrationResult.assignedHub}`);
    this.logger.log(`DeviceId: ${registrationResult.deviceId}`);

    const transport = DeviceMqttWs;
    const deviceConnectionString = `HostName=${registrationResult.assignedHub};DeviceId=${registrationResult.deviceId};SharedAccessKey=${deviceSymmetricKey}`;
    const client = Client.fromConnectionString(
      deviceConnectionString,
      transport
    );
    return { client, registrationResult };
  }

  async openAndInitDevice(deviceId: string, deviceInfo: HostDeviceSnapshot) {
    const { client } = await this.registerNewIotDevice(deviceId);
    await client.open();
    this.logger.log('Device connected to IoT Hub');
    this.applyRemoteActions(client);
    await this.readDeviceUpdates(client, deviceInfo);
    this.receiveMessages(client);
  }

  private async sendTelemetry(client: Client, data: Record<string, unknown>) {
    const message = new Message(JSON.stringify(data));
    await client.sendEvent(message);
  }

  private startSendingTelemetry(client: Client, telemetryInterval: number) {
    let fridgeTemp = 4;
    let doorOpen = false;
    let itemsStored = 20;
    setInterval(async () => {
      doorOpen = Math.random() < 0.3 ? !doorOpen : doorOpen;
      fridgeTemp += doorOpen ? 0.5 : -0.1;
      fridgeTemp = Math.min(Math.max(fridgeTemp, 2), 8);
      itemsStored += Math.floor(Math.random() * 3 - 1);
      itemsStored = Math.min(Math.max(itemsStored, 10), 25);
      const telemetry = {
        fridgeTemp: parseFloat(fridgeTemp.toFixed(1)),
        doorOpen,
        energyUsage: doorOpen ? 1 + Math.random() * 0.3 : 0.5,
        itemsStored,
      };
      await this.sendTelemetry(client, telemetry);
    }, telemetryInterval);
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
      this.logger.log('New device registration');
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
    }
  }

  private receiveMessages(client: Client) {
    client.on('message', async (msg) => {
      try {
        await client.complete(msg);
      } catch (err) {
        this.logger.error('Error completing message');
      }
    });
  }

  private applyRemoteActions(client: Client) {
    client.onDeviceMethod('reboot', async (request, response) => {
      try {
        await response.send(200, 'Rebooting device...');
        // this.startSendingTelemetry(client, telemetryInterval);
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
