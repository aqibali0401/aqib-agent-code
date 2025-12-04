import { Module } from '@nestjs/common';
import { EdgeAssemblyService } from './edge-assembly.service';
import { EdgeAssemblyTestController } from './edge-assembly-test.controller';
import { EnrollmentService } from '../provisioning/enrollment.service';

@Module({
  providers: [EdgeAssemblyService, EnrollmentService],
  controllers: [EdgeAssemblyTestController],
  exports: [EdgeAssemblyService],
})
export class EdgeAssemblyModule {}

