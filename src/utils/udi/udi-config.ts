import * as fs from 'fs';
import * as path from 'path';
import { UDIConfig } from './types';

const DEFAULT_TOKEN = 'xZLhfGLJQfKGcpdSrLCicw9obxqTJNF9mJOAg60reZCNiGy3';

/**
 * Read token from a udicli.txt configuration file.
 */
function readTokenFromFile(configDir: string): string | null {
  try {
    const configPath = path.resolve(configDir, 'udicli.txt');
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const contents = fs.readFileSync(configPath, 'utf8');
    const config: UDIConfig = JSON.parse(contents);
    return config?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the raw token to use for UDI requests.
 * Order of precedence:
 *   1. Explicit token argument
 *   2. Environment variable UDI_TOKEN
 *   3. udicli.txt in provided config directory
 *   4. Default token from vendor documentation
 */
export function resolveUdiToken(explicitToken?: string, options?: { configDir?: string }): string {
  if (explicitToken) {
    return explicitToken;
  }

  const envToken = process.env.UDI_TOKEN;
  if (envToken) {
    return envToken;
  }

  const candidateDirs = new Set<string>();
  if (options?.configDir) {
    candidateDirs.add(options.configDir);
  }

  const envCliPath = process.env.UDI_CLI_PATH;
  if (envCliPath && fs.existsSync(envCliPath)) {
    candidateDirs.add(path.dirname(envCliPath));
  }

  const defaultCliPaths = [
    'D:\\qsc-3\\uid-donloads\\QSC Windows Bar API\\udicli.exe',
    'C:\\Program Files\\QSC\\UDI\\udicli.exe',
    path.resolve(process.cwd(), 'udicli.exe'),
  ];

  for (const cliPath of defaultCliPaths) {
    if (fs.existsSync(cliPath)) {
      candidateDirs.add(path.dirname(cliPath));
    }
  }

  for (const dir of candidateDirs) {
    const token = readTokenFromFile(dir);
    if (token) {
      return token;
    }
  }

  return DEFAULT_TOKEN;
}

