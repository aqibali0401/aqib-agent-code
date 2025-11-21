/**
 * UDI Framework CLI Wrapper
 * Fallback method using udicli.exe (Improved version)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { UDISystemInfo } from './types';
import { resolveUdiToken } from './udi-config';

const execFileAsync = promisify(execFile);

/**
 * Resolve path to udicli.exe
 * Checks environment variable, common paths, and PATH
 */
export function resolveUdiCliPath(explicitPath?: string): string {
  // Check explicit path first
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }

  // Check environment variable
  const envPath = process.env.UDI_CLI_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // Check common installation paths
  const commonPaths = [
    'D:\\qsc-3\\uid-donloads\\QSC Windows Bar API\\udicli.exe',
    'C:\\Program Files\\QSC\\UDI\\udicli.exe',
    path.join(process.cwd(), 'udicli.exe'),
  ];

  for (const cliPath of commonPaths) {
    if (fs.existsSync(cliPath)) {
      return cliPath;
    }
  }

  // If not found, assume it's in PATH
  return 'udicli.exe';
}

/**
 * Parse JSON from CLI output
 * Handles various output formats including status lines
 */
function parseCliOutput(output: string): UDISystemInfo {
  // Find first '{' and last '}' to extract JSON
  const firstBrace = output.indexOf('{');
  const lastBrace = output.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON found in CLI output');
  }

  const jsonString = output.slice(firstBrace, lastBrace + 1);

  try {
    const systemInfo: UDISystemInfo = JSON.parse(jsonString);

    // Validate required fields
    if (!systemInfo.model || !systemInfo.serial) {
      throw new Error('CLI response missing required fields (model or serial)');
    }

    return systemInfo;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON from CLI: ${error.message}`);
    }
    throw error;
  }
}

/**
 * UDI CLI Wrapper
 * Handles CLI-based communication with UDI framework
 */
export class UDICliWrapper {
  private udicliPath: string;
  private token: string;

  constructor(cliPath?: string, token?: string) {
    this.udicliPath = resolveUdiCliPath(cliPath);
    const configDir = this.udicliPath !== 'udicli.exe' && fs.existsSync(this.udicliPath)
      ? path.dirname(this.udicliPath)
      : undefined;
    this.token = resolveUdiToken(token, { configDir });
  }

  /**
   * Get system information via CLI
   * @param retryAttempt Current retry attempt (internal use)
   */
  async getSystemInfo(): Promise<UDISystemInfo> {
    const apiEndpoint = '/v1/aio/system/info';
    const args = ['get', apiEndpoint, `--token=${this.token}`];

    try {
      // Use execFile (more secure than exec, no shell injection)
      const { stdout, stderr } = await execFileAsync(this.udicliPath, args, {
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer
        encoding: 'utf8',
      });

      // Combine stdout and stderr (some CLI tools write to stderr)
      const output = (stdout || '') + (stderr || '');

      if (!output.trim()) {
        throw new Error('Empty output from CLI');
      }

      return parseCliOutput(output);
    } catch (error) {
      // Check if it's a "command not found" error
      if (
        error instanceof Error &&
        (error.message.includes('not found') ||
          error.message.includes('ENOENT') ||
          error.message.includes('spawn'))
      ) {
        throw new Error(
          `UDI CLI not found at: ${this.udicliPath}. ` +
          `Please ensure udicli.exe is installed and accessible. ` +
          `You can set UDI_CLI_PATH environment variable to specify the path.`
        );
      }

      // Format error message
      if (error instanceof Error) {
        throw new Error(`Failed to get UDI system info via CLI: ${error.message}`);
      }
      throw new Error(`Failed to get UDI system info via CLI: ${String(error)}`);
    }
  }

  /**
   * Check if CLI is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Check if file exists (if not using PATH)
      if (this.udicliPath !== 'udicli.exe' && !fs.existsSync(this.udicliPath)) {
        return false;
      }

      // Try a quick call (with short timeout)
      await this.getSystemInfo();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get CLI path
   */
  getCliPath(): string {
    return this.udicliPath;
  }
}

