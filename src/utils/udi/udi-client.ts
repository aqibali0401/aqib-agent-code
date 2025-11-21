/**
 * UDI Framework Unified Client
 * Main interface with fallback chain: CLI → Local snapshot → Cache
 */

import { UDICliWrapper } from './udi-cli-wrapper';
import { UDISystemInfo, UDIClientOptions, UDIMethod, CachedDeviceInfo } from './types';
import { UDICache } from './udi-cache';
import { getHostDeviceSnapshot } from '../device-info';

/**
 * Format device ID from model and serial
 */
function formatDeviceId(deviceType: string, model: string, serial: string): string {
  const norm = (v: string) => (v || '').trim().replace(/\s+/g, '-');
  return `${norm(deviceType)}_${norm(model)}_${norm(serial)}`;
}

/**
 * UDI Unified Client
 * Orchestrates CLI, Local snapshot, and Cache with automatic fallback
 */
export class UDIClient {
  private cliWrapper: UDICliWrapper;
  private cache: UDICache;
  private deviceType: string;
  private lastMethod: UDIMethod | null = null;

  constructor(options: UDIClientOptions = {}) {
    const {
      token,
      cliPath,
      cacheDir,
      cacheTtlMs = 3600000,
      cacheEnabled = true,
    } = options;

    this.deviceType = process.env.DEVICE_TYPE || 'AIO';

    // Initialize CLI wrapper
    this.cliWrapper = new UDICliWrapper(cliPath, token);

    // Initialize cache
    this.cache = new UDICache({
      cacheDir: cacheDir || process.env.UDI_CACHE_DIR,
      ttlMs: cacheTtlMs,
      enabled: cacheEnabled,
    });
  }

  /**
   * Get system information with fallback chain
   * Tries: CLI → Local snapshot → Cache
   */
  async getSystemInfo(): Promise<UDISystemInfo> {
    const cliInfo = await this.tryCli();
    if (cliInfo) {
      return cliInfo;
    }

    try {
      const localInfo = await this.buildLocalSnapshot();
      if (localInfo) {
        return localInfo;
      }
    } catch {
      // Ignore local snapshot errors and fall through to cache
    }

    const cachedInfo = this.tryCache();
    if (cachedInfo) {
      return cachedInfo;
    }

    throw new Error('Unable to retrieve device information from CLI, local snapshot, or cache.');
  }

  /**
   * Get formatted device ID
   * Uses getSystemInfo() and formats the result
   */
  async getDeviceId(): Promise<string> {
    const info = await this.getSystemInfo();
    return formatDeviceId(this.deviceType, info.model, info.serial);
  }

  /**
   * Check which methods are available
   */
  async checkAvailability(): Promise<{
    cli: boolean;
    cache: boolean;
    local: boolean;
    recommended: UDIMethod;
  }> {
    const cliAvailability = this.cliWrapper.checkAvailability().catch(() => false);

    const cli = await cliAvailability;
    const cached = this.cache.get();

    const recommended: UDIMethod = cli ? 'cli' : 'local';

    return { cli, cache: Boolean(cached), local: true, recommended };
  }

  /**
   * Get the last method used
   */
  getLastMethod(): UDIMethod | null {
    return this.lastMethod;
  }

  private async tryCli(): Promise<UDISystemInfo | null> {
    try {
      const info = await this.cliWrapper.getSystemInfo();
      this.cache.set(this.toCachedInfo(info, 'cli'));
      this.lastMethod = 'cli';
      return info;
    } catch {
      return null;
    }
  }

  private tryCache(): UDISystemInfo | null {
    const cached = this.cache.get();
    if (!cached) {
      return null;
    }
    this.lastMethod = 'cache';
    return this.fromCachedInfo(cached);
  }

  private async buildLocalSnapshot(): Promise<UDISystemInfo> {
    const snapshot = await getHostDeviceSnapshot();
    const localInfo: UDISystemInfo = {
      application: 'Local',
      firmware: snapshot.os?.release || '',
      lastUpdate: new Date().toISOString(),
      model: snapshot.system?.model || 'MODEL',
      name: snapshot.hostname || 'UNKNOWN',
      serial: snapshot.system?.serial || snapshot.system?.uuid || 'SERIAL',
    };

    this.cache.set(this.toCachedInfo(localInfo, 'local'));
    this.lastMethod = 'local';
    return localInfo;
  }

  private toCachedInfo(info: UDISystemInfo, source: UDIMethod): CachedDeviceInfo {
    return {
      deviceId: formatDeviceId(this.deviceType, info.model, info.serial),
      model: info.model,
      serial: info.serial,
      name: info.name,
      firmware: info.firmware,
      timestamp: new Date().toISOString(),
      source,
    };
  }

  private fromCachedInfo(info: CachedDeviceInfo): UDISystemInfo {
    return {
      application: info.source === 'local' ? 'Local' : 'Cached',
      firmware: info.firmware,
      lastUpdate: info.timestamp,
      model: info.model,
      name: info.name,
      serial: info.serial,
    };
  }
}

/**
 * Default instance (singleton pattern)
 * Can be used for convenience, or create custom instances
 */
let defaultInstance: UDIClient | null = null;

/**
 * Get default UDI client instance
 */
export function getUDIClient(options?: UDIClientOptions): UDIClient {
  if (!defaultInstance) {
    defaultInstance = new UDIClient(options);
  }
  return defaultInstance;
}

/**
 * Export convenience functions
 */
export async function getUDISystemInfo(): Promise<UDISystemInfo> {
  return getUDIClient().getSystemInfo();
}

export async function getAioDeviceId(): Promise<string> {
  return getUDIClient().getDeviceId();
}

