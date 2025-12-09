import { Module } from '@nestjs/common';
import { EdgeAssemblyService } from './edge-assembly.service';
import { EdgeAssemblyTestController } from './edge-assembly-test.controller';
import { EnrollmentService } from '../provisioning/enrollment.service';
import { DpsProvisioningService } from '../provisioning/dps-provisioning.service';
import { IoTHubConnectionService } from '../provisioning/iot-hub-connection.service';

@Module({
  providers: [
    EdgeAssemblyService,
    EnrollmentService,
    DpsProvisioningService,
    IoTHubConnectionService,
  ],
  controllers: [EdgeAssemblyTestController],
  exports: [EdgeAssemblyService],
})
export class EdgeAssemblyModule {}

