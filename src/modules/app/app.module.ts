import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as joi from 'joi';
import { WinstonModule } from 'nest-winston';
import { AccessControlModule } from 'nest-access-control';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import { AuthModule } from '../auth/auth.module';
import { McpModule } from '../mcp/mcp.module';
import { ProfileModule } from '../profile/profile.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { roles } from './app.roles';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: joi.object({
        APP_ENV: joi
          .string()
          .valid('development', 'production')
          .default('development'),
        APP_URL: joi.string().default('http://localhost'),
        PORT: joi.number().default(9000),
        WEBTOKEN_SECRET_KEY: joi.string().required(),
        WEBTOKEN_EXPIRATION_TIME: joi.number().default(1800),
        DB_URL: joi.string().regex(/^mongodb/).required(),
        MCP_SERVER_NAME: joi.string().default('nest-rest-mongo-mcp'),
        MCP_SERVER_VERSION: joi.string().default('1.0.0'),
        MCP_CLIENT_REMOTES: joi.string().allow('').default(''),
        MCP_ALLOWED_MODELS: joi.string().allow('').default('Profile'),
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('DB_URL'),
      }),
    }),
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.get('APP_ENV') === 'development'
          ? {
              level: 'info',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.simple(),
              ),
              defaultMeta: { service: 'nest-mongoose-service' },
              transports: [new winston.transports.Console()],
            }
          : {
              level: 'info',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
              defaultMeta: { service: 'nest-mongoose-service' },
              transports: [
                new winston.transports.Console(),
                new winston.transports.File({
                  filename: 'logs/error.log',
                  level: 'error',
                }),
                new DailyRotateFile({
                  filename: 'logs/application-%DATE%.log',
                  datePattern: 'YYYY-MM-DD',
                  zippedArchive: true,
                  maxSize: '20m',
                  maxFiles: '14d',
                }),
              ],
            },
    }),
    AccessControlModule.forRoles(roles),
    AuthModule,
    ProfileModule,
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
