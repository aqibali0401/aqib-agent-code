import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  PROVISIONING_IDSCOPE!: string;

  @IsString()
  PROVISIONING_GROUP_SYMMETRIC_KEY!: string;

  @IsOptional()
  @IsString()
  PROVISIONING_HOST?: string;

  @IsOptional()
  @IsString()
  PORT?: string;

  @IsOptional()
  @IsString()
  LOG_RETAIN_PERIOD?: string;
}

export default function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}


