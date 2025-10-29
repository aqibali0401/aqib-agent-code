import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { LoggerModule } from './logger.module';
import { EdgeAssemblyModule } from './edge-assembly/edge-assembly.module';

@Module({
  imports: [ConfigModule, LoggerModule, EdgeAssemblyModule],
  controllers: [HealthController],
})
export class AppModule {}
