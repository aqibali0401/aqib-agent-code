import { Module } from '@nestjs/common';
import { IoTService } from './iot.service';

@Module({
  providers: [IoTService],
  exports: [IoTService],
})
export class IoTModule {}


