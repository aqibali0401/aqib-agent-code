import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  PORT?: string;

  @IsOptional()
  @IsString()
  LOG_RETAIN_PERIOD?: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;

  @IsOptional()
  @IsString()
  DEVICE_ID?: string; // Set dynamically at runtime - optional in .env

  @IsOptional()
  @IsString()
  DEVICE_TYPE?: string;

  @IsOptional()
  @IsString()
  X509_CERT_FILE?: string; // Set dynamically at runtime - optional in .env

  @IsOptional()
  @IsString()
  X509_KEY_FILE?: string; // Set dynamically at runtime - optional in .env

  @IsOptional()
  @IsString()
  X509_PASSPHRASE?: string; // Optional - only needed if certificates are encrypted

  @IsOptional()
  @IsString()
  ENABLE_PERIODIC_TELEMETRY?: string;

  @IsOptional()
  @IsString()
  TELEMETRY_INTERVAL_MS?: string;
}

export default function validate(
  config: Record<string, unknown>
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
