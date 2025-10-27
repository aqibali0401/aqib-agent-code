import { Controller, Post, Get, Body, Param, Inject, LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { EdgeAssemblyService } from './edge-assembly.service';

@Controller('iot-test')
export class EdgeAssemblyTestController {
  constructor(
    private readonly edgeAssemblyService: EdgeAssemblyService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {}

  /**
   * GET /iot-test/status
   * Check if the IoT connection is ready
   */
  @Get('status')
  async getStatus() {
    const isReady = this.edgeAssemblyService.isReady();
    const isConnected = isReady ? await this.edgeAssemblyService.checkConnection() : false;

    return {
      status: 'ok',
      iotReady: isReady,
      iotConnected: isConnected,
      deviceId: process.env.DEVICE_ID,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * POST /iot-test/send-telemetry
   * Send telemetry data to IoT Hub
   * 
   * Body: {
   *   "topic": "temperature",
   *   "data": { "value": 25.5, "unit": "celsius" }
   * }
   */
  @Post('send-telemetry')
  async sendTelemetry(@Body() body: { topic: string; data: any }) {
    const { topic, data } = body;

    if (!topic || !data) {
      return {
        success: false,
        error: 'Missing topic or data in request body',
      };
    }

    try {
      await this.edgeAssemblyService.sendTelemetry(topic, data);
      this.logger.log(`✅ Telemetry sent via API - Topic: ${topic}`);

      return {
        success: true,
        message: 'Telemetry sent successfully',
        topic,
        data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to send telemetry via API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * POST /iot-test/send-message
   * Send a simple message to IoT Hub
   * 
   * Body: {
   *   "message": "Hello from device!",
   *   "topic": "general" (optional)
   * }
   */
  @Post('send-message')
  async sendMessage(@Body() body: { message: string; topic?: string }) {
    const { message, topic = 'general' } = body;

    if (!message) {
      return {
        success: false,
        error: 'Missing message in request body',
      };
    }

    try {
      await this.edgeAssemblyService.sendMessage(message, topic);
      this.logger.log(`✅ Message sent via API: ${message}`);

      return {
        success: true,
        message: 'Message sent successfully',
        sentMessage: message,
        topic,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to send message via API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * POST /iot-test/update-twin
   * Update device twin properties
   * 
   * Body: {
   *   "properties": { "firmwareVersion": "2.0.0", "location": "Building B" }
   * }
   */
  @Post('update-twin')
  async updateTwin(@Body() body: { properties: any }) {
    const { properties } = body;

    if (!properties) {
      return {
        success: false,
        error: 'Missing properties in request body',
      };
    }

    try {
      await this.edgeAssemblyService.updateTwin(properties);
      this.logger.log(`✅ Twin updated via API:`, properties);

      return {
        success: true,
        message: 'Device twin updated successfully',
        properties,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to update twin via API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * POST /iot-test/telemetry/start
   * Start sending periodic telemetry
   * 
   * Body: {
   *   "intervalMs": 30000 (optional)
   * }
   */
  @Post('telemetry/start')
  async startTelemetry(@Body() body?: { intervalMs?: number }) {
    try {
      this.edgeAssemblyService.startPeriodicTelemetry(body?.intervalMs);

      return {
        success: true,
        message: 'Periodic telemetry started',
        intervalMs: body?.intervalMs || parseInt(process.env.TELEMETRY_INTERVAL_MS || '30000', 10),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to start telemetry via API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * POST /iot-test/telemetry/stop
   * Stop sending periodic telemetry
   */
  @Post('telemetry/stop')
  async stopTelemetry() {
    try {
      this.edgeAssemblyService.stopPeriodicTelemetry();

      return {
        success: true,
        message: 'Periodic telemetry stopped',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to stop telemetry via API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * GET /iot-test/help
   * Show available test endpoints
   */
  @Get('help')
  getHelp() {
    return {
      message: 'IoT Bidirectional Communication Test Endpoints',
      endpoints: [
        {
          method: 'GET',
          path: '/iot-test/status',
          description: 'Check IoT connection status',
        },
        {
          method: 'POST',
          path: '/iot-test/send-telemetry',
          description: 'Send telemetry data',
          body: { topic: 'string', data: 'any' },
        },
        {
          method: 'POST',
          path: '/iot-test/send-message',
          description: 'Send a simple message',
          body: { message: 'string', topic: 'string (optional)' },
        },
        {
          method: 'POST',
          path: '/iot-test/update-twin',
          description: 'Update device twin properties',
          body: { properties: 'object' },
        },
        {
          method: 'POST',
          path: '/iot-test/telemetry/start',
          description: 'Start periodic telemetry',
          body: { intervalMs: 'number (optional)' },
        },
        {
          method: 'POST',
          path: '/iot-test/telemetry/stop',
          description: 'Stop periodic telemetry',
        },
      ],
      cloudToDevice: {
        directMethods: ['reboot', 'upgrade', 'healthCheck'],
        messages: 'Send C2D messages from Azure Portal with JSON payload: {"type": "alert|config_update|notification|command", "payload": {...}}',
      },
    };
  }
}

