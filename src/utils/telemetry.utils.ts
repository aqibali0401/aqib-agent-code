import { LoggerService } from '@nestjs/common';
import { EdgeAssembly } from '@qsc/edge-assembly';
import { getHostDeviceSnapshot } from './device-info';
import { DEVICE_TYPE, EVENT_TYPE } from '../constants/app.constants';

/**
 * Interface for telemetry context
 */
export interface TelemetryContext {
  edgeDevice: EdgeAssembly;
  deviceId: string | null;
  logger: LoggerService;
}

/**
 * Build standard device telemetry payload
 * @param snapshot - Device snapshot from getHostDeviceSnapshot()
 * @param deviceId - Device ID (can be null)
 * @param fallbackDeviceId - Optional fallback device ID if deviceId is not set
 * @returns Standardized telemetry payload
 */
export function buildDeviceTelemetryPayload(
  snapshot: any,
  deviceId: string | null,
  fallbackDeviceId?: string
): any {
  return {
    eventType: EVENT_TYPE.NEW_DEVICE_REGISTRATION,
    deviceId: deviceId || fallbackDeviceId || process.env.DEVICE_ID,
    serial: snapshot.system?.serial,
    name: snapshot.hostname,
    model: snapshot.system?.model,
    uptime: snapshot.uptime * 1000, // Convert to milliseconds
    modelNumber: snapshot.system?.model,
    serialNo: snapshot.system?.serial,
    deviceType: DEVICE_TYPE,
  };
}

/**
 * Get plugin adapter from EdgeAssembly instance
 */
function getPluginAdapter(edgeDevice: EdgeAssembly): { telemetryService: any; adapter: any } {
  const edgeDeviceAny = edgeDevice as any;
  return {
    telemetryService: edgeDeviceAny.plugin?.telemetryService,
    adapter: edgeDeviceAny.plugin?.connectivityPlugin,
  };
}

/**
 * Send telemetry data to IoT Hub (Device-to-Cloud)
 * Uses the internal TelemetryService from the edge-assembly package
 * 
 * @param context - Telemetry context containing edgeDevice, deviceId, and logger
 * @param topic - Topic/route identifier (included in telemetry data as 'topic' field)
 * @param data - Telemetry data to send (can be object or string)
 */
export async function sendTelemetry(
  context: TelemetryContext,
  topic: string,
  data: any
): Promise<void> {
  const { edgeDevice, logger } = context;

  try {
    const { telemetryService, adapter } = getPluginAdapter(edgeDevice);

    // Ensure we are connected even if initialization flag hasn't been set yet
    if (!adapter || typeof adapter.isConnected !== 'function' || !adapter.isConnected()) {
      throw new Error('Not connected to Azure IoT Hub');
    }

    // Prepare telemetry payload
    const telemetryPayload = typeof data === 'string' ? { message: data } : { ...data };

    // Add topic and timestamp to payload
    telemetryPayload.topic = topic;
    if (!telemetryPayload.timestamp) {
      telemetryPayload.timestamp = new Date().toISOString();
    }

    // Prefer TelemetryService; fall back to adapter if needed
    if (telemetryService && typeof telemetryService.sendTelemetry === 'function') {
      await telemetryService.sendTelemetry(telemetryPayload);
    } else if (adapter && typeof adapter.sendTelemetry === 'function') {
      await adapter.sendTelemetry(telemetryPayload);
    } else {
      throw new Error('No telemetry sender available (TelemetryService and AzureAdapter missing)');
    }

    logger.log(`Telemetry sent successfully - Topic: ${topic}, Data: ${JSON.stringify(telemetryPayload)}`);
  } catch (error) {
    logger.error(`Failed to send telemetry: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Send a simple notification message to IoT Hub
 */
export async function sendMessage(
  context: TelemetryContext,
  message: string,
  topic: string = 'general'
): Promise<void> {
  return sendTelemetry(context, topic, { message, timestamp: new Date().toISOString() });
}

/**
 * Class to manage periodic telemetry
 */
export class PeriodicTelemetryManager {
  private telemetryInterval: NodeJS.Timeout | null = null;
  private context: TelemetryContext;

  constructor(context: TelemetryContext) {
    this.context = context;
  }

  /**
   * Update the context (useful when deviceId changes)
   */
  updateContext(context: Partial<TelemetryContext>) {
    this.context = { ...this.context, ...context };
  }

  /**
   * Start sending periodic telemetry
   */
  start(intervalMs?: number) {
    const interval = intervalMs || parseInt(process.env.TELEMETRY_INTERVAL_MS || '30000', 10);

    if (this.telemetryInterval) {
      this.context.logger.warn('Periodic telemetry already running');
      return;
    }

    this.context.logger.log(`Starting periodic telemetry (every ${interval}ms)`);

    this.telemetryInterval = setInterval(async () => {
      try {
        const snapshot = await getHostDeviceSnapshot();
        const telemetryData = buildDeviceTelemetryPayload(snapshot, this.context.deviceId);
        await sendTelemetry(this.context, 'deviceTelemetry', telemetryData);
      } catch (error) {
        this.context.logger.error('Error sending periodic telemetry:', error);
      }
    }, interval);
  }

  /**
   * Stop sending periodic telemetry
   */
  stop() {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
      this.context.logger.log('Stopped periodic telemetry');
    }
  }

  /**
   * Check if periodic telemetry is running
   */
  isRunning(): boolean {
    return this.telemetryInterval !== null;
  }
}
