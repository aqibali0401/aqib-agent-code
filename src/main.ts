import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.enableCors();

  const port = process.env.PORT || 5000;
  await app.listen(port as number);
  Logger.log(`Server is listening on port: ${port}`);
}

bootstrap();


