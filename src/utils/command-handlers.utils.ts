import { LoggerService } from '@nestjs/common';
import { EdgeAssembly } from '@qsc/edge-assembly';
import { getHostDeviceSnapshot } from './device-info';
import { DEVICE_TYPE } from '../constants/app.constants';

/**
 * Interface for command handler context
 */
export interface CommandHandlerContext {
  edgeDevice: EdgeAssembly;
  deviceId: string | null;
  logger: LoggerService;
}

/**
 * Interface for message handler callbacks
 */
export interface MessageHandlerCallbacks {
  onPlainTextMessage?: (message: string) => void;
  onCloudMessage?: (message: any) => void;
}

/**
 * Register direct method handlers (request-response pattern)
 */
export function registerDirectMethods(context: CommandHandlerContext): void {
  const { edgeDevice, deviceId, logger } = context;

  // Reboot command handler
  edgeDevice.onRequest('reboot', async (requestId, data) => {
    logger.log(`Reboot command received [${requestId}]:`, data);

    try {
      // Add your reboot logic here
      // Example: execSync('shutdown /r /t 10'); // Windows
      // Example: execSync('sudo reboot'); // Linux

      return {
        status: 'success',
        message: 'Rebooting device...',
        timestamp: new Date().toISOString(),
        requestId,
      };
    } catch (error) {
      logger.error('Error handling reboot command:', error);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        requestId,
      };
    }
  });

  // Upgrade command handler
  edgeDevice.onRequest('upgrade', async (requestId, data) => {
    logger.log(`Upgrade command received [${requestId}]:`, data);

    try {
      const payload = typeof data === 'string' ? JSON.parse(data) : data;
      const version = payload.version;

      if (!version) {
        throw new Error('Upgrade version missing');
      }

      // Add your upgrade logic here
      // Example: Download new version, extract, restart

      return {
        status: 'success',
        message: `Upgrading device to version ${version}...`,
        currentVersion: process.env.APP_VERSION,
        targetVersion: version,
        timestamp: new Date().toISOString(),
        requestId,
      };
    } catch (error) {
      logger.error('Error handling upgrade command:', error);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        requestId,
      };
    }
  });

  // Custom health check command
  edgeDevice.onRequest('healthCheck', async (requestId, data) => {
    logger.log(`Health check requested [${requestId}]`);

    try {
      const snapshot = await getHostDeviceSnapshot();

      return {
        status: 'healthy',
        uptime: snapshot.uptime,
        version: process.env.APP_VERSION,
        timestamp: new Date().toISOString(),
        requestId,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        requestId,
      };
    }
  });

  // Get device information
  edgeDevice.onRequest('getDeviceInfo', async (requestId, data) => {
    logger.log(`Get device info requested [${requestId}]`);

    try {
      return {
        status: 'success',
        deviceId: deviceId || process.env.DEVICE_ID || 'unknown',
        deviceType: DEVICE_TYPE,
        timestamp: new Date().toISOString(),
        requestId,
      };
    } catch (error) {
      logger.error('Error getting device info:', error);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        requestId,
      };
    }
  });

  logger.log('Direct method handlers registered (reboot, upgrade, healthCheck, getDeviceInfo)');
}

/**
 * Handle plain text messages (default implementation)
 */
export function handlePlainTextMessage(message: string, logger: LoggerService): void {
  logger.log(`Plain text C2D message: ${message}`);
  // You can add custom logic here for plain text messages
  // For example, you might want to log them, display them, or trigger specific actions
}

/**
 * Handle parsed cloud-to-device messages (JSON format)
 */
export function handleCloudMessage(message: any, logger: LoggerService): void {
  const { type, payload, timestamp } = message;

  logger.log(`Message Type: ${type || 'unknown'}`);
  logger.log(`Payload:`, payload);

  // Handle different message types
  switch (type) {
    case 'alert':
      logger.warn(`Alert received: ${payload?.message || JSON.stringify(payload)}`);
      break;

    case 'config_update':
      logger.log(`Configuration update: ${JSON.stringify(payload)}`);
      // Update your application configuration here
      break;

    case 'notification':
      logger.log(`Notification: ${payload?.message || JSON.stringify(payload)}`);
      break;

    case 'command':
      logger.log(`Command: ${payload?.command || JSON.stringify(payload)}`);
      // Execute command logic here
      break;

    default:
      logger.log(`Unknown message type: ${type || 'none'}`);
      logger.log(`Full message: ${JSON.stringify(message)}`);
  }
}

/**
 * Handle incoming cloud-to-device messages
 * This method handles both JSON and plain text messages
 */
export function handleIncomingMessage(
  message: any,
  payload: any,
  logger: LoggerService,
  callbacks?: MessageHandlerCallbacks
): void {
  const onPlainText = callbacks?.onPlainTextMessage || ((msg) => handlePlainTextMessage(msg, logger));
  const onCloudMsg = callbacks?.onCloudMessage || ((msg) => handleCloudMessage(msg, logger));

  try {
    // The payload might already be parsed as JSON, or it might be a string
    let parsedPayload: any;

    if (typeof payload === 'string') {
      // Try to parse as JSON, but handle plain text gracefully
      try {
        parsedPayload = JSON.parse(payload);
      } catch (parseError) {
        // It's plain text, not JSON
        logger.log(`Plain text message received: ${payload}`);
        onPlainText(payload);
        return;
      }
    } else {
      // Already parsed or is an object
      parsedPayload = payload;
    }

    // Handle structured JSON messages
    onCloudMsg(parsedPayload);
  } catch (error) {
    logger.error(`Error handling incoming message: ${error instanceof Error ? error.message : String(error)}`);
    // If payload is a string, try to handle it as plain text
    if (typeof payload === 'string') {
      logger.log(`Treating as plain text message: ${payload}`);
      onPlainText(payload);
    }
  }
}

/**
 * Register cloud-to-device message handlers (one-way notifications)
 * 
 * NOTE: Updated for @qsc/edge-assembly v0.0.0 - now supports C2D messages
 * Messages are automatically received by AzureAdapter and routed to registered handlers
 */
export function registerMessageHandlers(
  context: CommandHandlerContext,
  callbacks?: MessageHandlerCallbacks
): void {
  const { edgeDevice, logger } = context;
  const onPlainText = callbacks?.onPlainTextMessage || ((msg) => handlePlainTextMessage(msg, logger));
  const onCloudMsg = callbacks?.onCloudMessage || ((msg) => handleCloudMessage(msg, logger));

  try {
    // Access the AzureAdapter through the edge-assembly's internal plugin
    // The edge-assembly package uses a plugin pattern internally
    const edgeDeviceAny = edgeDevice as any;

    // Try to access the plugin property (it's internal but we can access it)
    // The plugin structure: edgeDevice.plugin.connectivityPlugin
    if (edgeDeviceAny.plugin && edgeDeviceAny.plugin.connectivityPlugin) {
      const azureAdapter = edgeDeviceAny.plugin.connectivityPlugin;

      // CRITICAL FIX: Patch the _handleIncomingMessage method to handle both JSON and plain text
      // The original implementation tries to parse ALL messages as JSON, which fails for plain text
      const originalHandleIncomingMessage = azureAdapter._handleIncomingMessage?.bind(azureAdapter);

      azureAdapter._handleIncomingMessage = (message: any) => {
        let payload: any;
        let messageProcessed = false;
        const messageType = message.properties?.getValue?.('type') || 'unknown';

        try {
          // Try to parse as JSON first
          const messageData = message.getData().toString();
          try {
            payload = JSON.parse(messageData);
            // Log JSON messages at debug level if available, otherwise use log
            if ((logger as any).debug) {
              (logger as any).debug(`Received JSON message: ${JSON.stringify(payload)}`);
            } else {
              logger.log(`Received JSON message: ${JSON.stringify(payload)}`);
            }
          } catch (parseError) {
            // It's plain text, not JSON - handle it as plain text
            payload = messageData;
            // Log plain text messages at debug level if available, otherwise use log
            if ((logger as any).debug) {
              (logger as any).debug(`Received plain text message: ${payload}`);
            } else {
              logger.log(`Received plain text message: ${payload}`);
            }

            // Call the handler for plain text messages
            const handler = azureAdapter._getMessageHandler(messageType);
            if (handler) {
              handler(message, payload);
              messageProcessed = true;
            } else {
              // No handler registered, handle as plain text
              onPlainText(payload);
              messageProcessed = true;
            }

            // Acknowledge the message
            azureAdapter._acknowledgeMessage(message, messageProcessed);
            return;
          }

          // For JSON messages, proceed with normal handler logic
          const handler = azureAdapter._getMessageHandler(messageType);
          if (handler) {
            handler(message, payload);
            messageProcessed = true;
          } else {
            logger.warn(`No handler registered for message type: ${messageType}`);
            // Try to handle as generic JSON message
            onCloudMsg(payload);
            messageProcessed = true;
          }
        } catch (error) {
          logger.error(`Error processing received message: ${error instanceof Error ? error.message : String(error)}`);
          // Try to handle as plain text if it's a string
          try {
            const messageData = message.getData().toString();
            onPlainText(messageData);
            messageProcessed = true;
          } catch (fallbackError) {
            // Ignore fallback errors
          }
        }

        // Acknowledge the message
        azureAdapter._acknowledgeMessage(message, messageProcessed);
      };

      // Helper to create message handler
      const createMessageHandler = (message: any, payload: any) => {
        handleIncomingMessage(message, payload, logger, callbacks);
      };

      // Register a catch-all handler for 'unknown' type (default when no type property is set)
      azureAdapter.registerMessageHandler('unknown', createMessageHandler);

      // Register handlers for specific message types
      azureAdapter.registerMessageHandler('alert', createMessageHandler);
      azureAdapter.registerMessageHandler('config_update', createMessageHandler);
      azureAdapter.registerMessageHandler('notification', createMessageHandler);
      azureAdapter.registerMessageHandler('command', createMessageHandler);

      logger.log('Cloud-to-Device message handlers registered successfully');
    } else {
      logger.warn('Could not access AzureAdapter - C2D messages may not be handled properly');
      logger.warn('This may cause JSON parsing errors for plain text messages');
    }
  } catch (error) {
    logger.error('Failed to register C2D message handlers:', error);
    logger.warn('C2D messages may not be handled properly');
  }
}

/**
 * Register all command handlers (direct methods + C2D messages)
 */
export function registerAllCommandHandlers(
  context: CommandHandlerContext,
  callbacks?: MessageHandlerCallbacks
): void {
  // Register Direct Method handlers (Request-Response)
  registerDirectMethods(context);

  // Register Cloud-to-Device Message handlers (One-way notifications)
  registerMessageHandlers(context, callbacks);
}
