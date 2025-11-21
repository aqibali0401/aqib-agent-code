/**
 * UDI Cache Utility
 * Provides in-memory + disk persistence for device information.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CachedDeviceInfo } from './types';

export interface UDICacheOptions {
  cacheDir?: string;
  ttlMs?: number;
  enabled?: boolean;
}

const DEFAULT_CACHE_FILE = path.join(process.cwd(), '.cache', 'udi-device-info.json');
const DEFAULT_TTL_MS = process.env.UDI_CACHE_TTL_MS ? parseInt(process.env.UDI_CACHE_TTL_MS) : 60 * 60 * 1000; // 1 hour

export class UDICache {
  private cacheFile: string;
  private ttlMs: number;
  private enabled: boolean;
  private memoryCache: { data: CachedDeviceInfo; expiresAt: number } | null = null;

  constructor(options: UDICacheOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.cacheFile = options.cacheDir
      ? path.join(options.cacheDir, 'udi-device-info.json')
      : DEFAULT_CACHE_FILE;
  }

  set(info: CachedDeviceInfo): void {
    if (!this.enabled) {
      return;
    }

    const expiresAt = Date.now() + this.ttlMs;
    this.memoryCache = { data: info, expiresAt };

    try {
      const dir = path.dirname(this.cacheFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cacheFile, JSON.stringify(info, null, 2), 'utf8');
    } catch {
      // Ignore disk write errors
    }
  }

  get(): CachedDeviceInfo | null {
    if (!this.enabled) {
      return null;
    }

    if (this.memoryCache && Date.now() < this.memoryCache.expiresAt) {
      return this.memoryCache.data;
    }

    try {
      if (!fs.existsSync(this.cacheFile)) {
        return null;
      }
      const contents = fs.readFileSync(this.cacheFile, 'utf8');
      const parsed: CachedDeviceInfo = JSON.parse(contents);
      this.memoryCache = { data: parsed, expiresAt: Date.now() + this.ttlMs };
      return parsed;
    } catch {
      return null;
    }
  }
}
