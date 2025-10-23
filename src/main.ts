import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { IoTService } from './iot/iot.service';

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

  // Now trigger IoT initialization so its logs come after the banner
  const iotService = app.get(IoTService);
  await iotService.initializeAfterAppStart();
}

bootstrap();
