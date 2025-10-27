import { Module } from '@nestjs/common';
import { EdgeAssemblyService } from './edge-assembly.service';
import { EdgeAssemblyTestController } from './edge-assembly-test.controller';

@Module({
  providers: [EdgeAssemblyService],
  controllers: [EdgeAssemblyTestController],
  exports: [EdgeAssemblyService],
})
export class EdgeAssemblyModule {}

