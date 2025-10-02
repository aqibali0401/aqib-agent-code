import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const retainingPeriod = process.env.LOG_RETAIN_PERIOD || '1d';
const baseErrorFolderPath = path.join(__dirname, '../../logs');

@Module({
  imports: [
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(
              (log) => `${log.timestamp} ${log.level}: ${log.message}`
            )
          ),
        }),
        new DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'combined-logs/combined-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
        }),
        new DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'error-logs/error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
          level: 'warn',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),
      ],
      exceptionHandlers: [
        new DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'exceptions/exceptions-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
        }),
      ],
      rejectionHandlers: [
        new DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'rejections/rejections-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
        }),
      ],
    }),
  ],
})
export class LoggerModule {}


