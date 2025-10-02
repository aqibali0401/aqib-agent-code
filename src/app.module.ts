import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { LoggerModule } from './logger.module';
import { IoTModule } from './iot/iot.module';

@Module({
  imports: [ConfigModule, LoggerModule, IoTModule],
  controllers: [HealthController],
})
export class AppModule {}
