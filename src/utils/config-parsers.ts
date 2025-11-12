import type { TransportType, SecurityType } from '@qsc/device-provisioner/dist/types';

export const parseBoolean = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return ['true', '1', 'yes'].includes(value.toLowerCase());
};

export const parseNumber = (value: string | undefined, defaultValue: number): number => {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

export type LoggerLevel = 'debug' | 'info' | 'warn' | 'error';

export const resolveLoggerLevel = (value: string | undefined): LoggerLevel => {
  switch (value) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
      return value;
    default:
      return 'info';
  }
};

export const parseTransportType = (value: string | undefined): TransportType => {
  switch (value?.toLowerCase()) {
    case 'mqttws':
      return 'mqttws';
    case 'amqp':
      return 'amqp';
    case 'amqpws':
      return 'amqpws';
    case 'http':
      return 'http';
    case 'mqtt':
    default:
      return 'mqtt';
  }
};

export const parseSecurityType = (value: string | undefined): SecurityType | undefined => {
  switch (value?.toLowerCase()) {
    case 'x509':
      return 'x509';
    case 'symmetrickey':
      return 'symmetricKey';
    default:
      return undefined;
  }
};

