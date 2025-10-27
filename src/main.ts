import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { IoTService } from './iot/iot.service';
import { EdgeAssemblyService } from './edge-assembly/edge-assembly.service';

// Load environment variables
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  const winstonLogger = app.get(WINSTON_MODULE_NEST_PROVIDER);

  app.enableCors();

  const port = process.env.PORT || 5000;
  await app.listen(port as number);

  winstonLogger.log(`Agent is listening on port: ${port}`);

  app.useLogger(winstonLogger);

  // Get services
  const iotService = app.get(IoTService);
  const edgeAssemblyService = app.get(EdgeAssemblyService);

  // Choose which service to use based on environment variable
  const useEdgeAssembly = process.env.USE_EDGE_ASSEMBLY === 'true';

  if (useEdgeAssembly) {
    winstonLogger.log('========================================');
    winstonLogger.log('🚀 Starting with Edge Assembly');
    winstonLogger.log('========================================');
    
    // Initialize Edge Assembly
    await edgeAssemblyService.initializeAfterAppStart();
  } else {
    winstonLogger.log('========================================');
    winstonLogger.log('🚀 Starting with Legacy IoT Service');
    winstonLogger.log('========================================');
    
    // Initialize legacy IoT service
    await iotService.initializeAfterAppStart();
  }

  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    winstonLogger.log('\n🛑 Received SIGINT, shutting down gracefully...');

    try {
      if (useEdgeAssembly) {
        await edgeAssemblyService.disconnect();
      }
      await app.close();
      winstonLogger.log('👋 Application closed successfully');
      process.exit(0);
    } catch (error) {
      winstonLogger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGTERM', async () => {
    winstonLogger.log('\n🛑 Received SIGTERM, shutting down gracefully...');

    try {
      if (useEdgeAssembly) {
        await edgeAssemblyService.disconnect();
      }
      await app.close();
      winstonLogger.log('👋 Application closed successfully');
      process.exit(0);
    } catch (error) {
      winstonLogger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
}

bootstrap();
