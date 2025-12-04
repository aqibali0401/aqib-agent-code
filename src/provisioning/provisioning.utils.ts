import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { LoggerService } from '@nestjs/common';
import { parseBoolean } from '../utils/config-parsers';
import { EnrollmentService } from './enrollment.service';

export interface AutoProvisionOptions {
  deviceId: string;
  model: string;
  serial: string;
  projectRoot: string;
  logger: LoggerService;
  enrollmentService: EnrollmentService;
}

export function resolveFilePath(filePath: string, baseDir: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
}

async function runPowerShellScript(
  scriptPath: string,
  args: string[],
  logger: LoggerService,
  requiresElevation: boolean = false
): Promise<void> {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`PowerShell script not found at ${scriptPath}`);
  }

  logger.log(`Executing ${scriptPath} ${args.join(' ')}`);

  // Resolve PowerShell executable path
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const powershellPaths = [
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(systemRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe', // Fallback to PATH
  ];

  let powershellExe: string | null = null;

  for (const psPath of powershellPaths) {
    if (psPath === 'powershell.exe') {
      powershellExe = psPath;
      break;
    }
    if (fs.existsSync(psPath)) {
      powershellExe = psPath;
      break;
    }
  }

  if (!powershellExe) {
    throw new Error('PowerShell executable not found. Please ensure PowerShell is installed.');
  }

  // If elevation is required, use a wrapper script that checks admin and provides guidance
  if (requiresElevation) {
    logger.warn(
      'TPM key creation requires administrator privileges. ' +
      'Please run this application from an elevated (administrator) PowerShell or Command Prompt.'
    );
    
    // Check if current process is elevated using a quick PowerShell command
    const isElevated = await new Promise<boolean>((resolve) => {
      const checkCmd = spawn(
        powershellExe!,
        [
          '-NoProfile',
          '-Command',
          '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
        ],
        { shell: false, stdio: 'pipe' }
      );
      
      let output = '';
      checkCmd.stdout?.on('data', (data) => { output += data.toString(); });
      checkCmd.on('exit', (code) => {
        resolve(code === 0 && output.trim().toLowerCase() === 'true');
      });
      checkCmd.on('error', () => resolve(false));
    });

    if (!isElevated) {
      throw new Error(
        'Administrator privileges required for TPM operations. ' +
        'Please restart VS Code or this application with "Run as Administrator".'
      );
    }
  }

  await new Promise<void>((resolve, reject) => {
    const spawnOptions: any = { stdio: 'inherit' };
    
    if (powershellExe === 'powershell.exe') {
      spawnOptions.shell = true;
    }

    const child = spawn(
      powershellExe!,
      ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      spawnOptions
    );

    child.on('error', (error) => {
      if (error.message.includes('ENOENT')) {
        reject(new Error(`PowerShell executable not found. Tried: ${powershellPaths.join(', ')}`));
      } else {
        reject(error);
      }
    });
    
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`PowerShell script ${scriptPath} exited with code ${code}`));
      }
    });
  });
}

export async function autoProvisionIfNeeded(options: AutoProvisionOptions): Promise<void> {
  const autoEnrollEnabled = parseBoolean(process.env.AUTO_ENROLL_ENABLED, true);
  if (!autoEnrollEnabled) {
    options.logger.log('AUTO_ENROLL_ENABLED=false. Skipping automatic provisioning steps.');
    return;
  }

  if (process.platform !== 'win32') {
    options.logger.warn('Automatic provisioning is supported only on Windows hosts. Skipping.');
    return;
  }

  const { deviceId, model, serial, projectRoot, logger, enrollmentService } = options;
  const scriptsDir = path.join(projectRoot, 'scripts');

  const tpmScriptPath = resolveFilePath(
    process.env.TPM_KEY_SCRIPT_PATH || path.join(scriptsDir, 'create-tpm-key.ps1'),
    projectRoot
  );

  const csrScriptPath = resolveFilePath(
    process.env.CSR_SCRIPT_PATH || path.join(scriptsDir, 'create-csr.ps1'),
    projectRoot
  );

  const csrPath = resolveFilePath(
    process.env.CSR_OUTPUT_PATH || path.join(projectRoot, `csr-${deviceId}.req`),
    projectRoot
  );
  process.env.CSR_OUTPUT_PATH = csrPath;
  const csrDir = path.dirname(csrPath);
  if (!fs.existsSync(csrDir)) {
    fs.mkdirSync(csrDir, { recursive: true });
  }

  await runPowerShellScript(tpmScriptPath, ['-DeviceId', deviceId], logger, true);

  logger.log('TPM key provisioning completed successfully.');

  

  if (!fs.existsSync(csrPath)) {
    logger.log(`CSR not found at ${csrPath}. Generating via ${csrScriptPath}`);
    await runPowerShellScript(
      csrScriptPath,
      ['-DeviceId', deviceId, '-Model', model, '-Serial', serial, '-OutputPath', csrPath],
      logger,
      false
    );
  } else {
    logger.log(`CSR already present at ${csrPath}, skipping generation.`);
  }

  const certEnv = process.env.X509_CERT_FILE;
  if (!certEnv) {
    logger.warn('X509_CERT_FILE is not configured; cannot persist device certificate.');
    return;
  }

  const certPath = resolveFilePath(certEnv, projectRoot);
  const chainPath = process.env.X509_CA_CHAIN_FILE
    ? resolveFilePath(process.env.X509_CA_CHAIN_FILE, projectRoot)
    : undefined;

  if (fs.existsSync(certPath)) {
    logger.log(`Device certificate already exists at ${certPath}.`);
    return;
  }

  await enrollmentService.enrollDeviceCertificate({
    deviceId,
    model,
    serial,
    csrPath,
    certPath,
    chainPath,
  });
}
