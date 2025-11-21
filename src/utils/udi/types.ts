/**
 * UDI Framework Type Definitions
 */

export interface UDISystemInfo {
  application: string;
  firmware: string;
  lastUpdate: string;
  model: string;
  name: string;
  serial: string;
}

export interface UDIConfig {
  token: string;
}

export interface UDIClientOptions {
  token?: string;
  cliPath?: string;
  cacheDir?: string;
  cacheTtlMs?: number;
  cacheEnabled?: boolean;
}

export interface CachedDeviceInfo {
  deviceId: string;
  model: string;
  serial: string;
  name: string;
  firmware: string;
  timestamp: string;
  source: UDIMethod;
}

export type UDIMethod = 'cli' | 'cache' | 'local';

