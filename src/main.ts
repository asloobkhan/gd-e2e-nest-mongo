import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import fastifyRateLimiter from '@fastify/rate-limit';

import { AppModule } from './modules/app/app.module';

export const SWAGGER_API_ROOT = 'api/docs';
export const SWAGGER_API_NAME = 'API';
export const SWAGGER_API_DESCRIPTION = 'API Description';
export const SWAGGER_API_CURRENT_VERSION = '1.0';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    { bufferLogs: true },
  );

  const config = app.get(ConfigService);

  const options = new DocumentBuilder()
    .setTitle(SWAGGER_API_NAME)
    .setDescription(SWAGGER_API_DESCRIPTION)
    .setVersion(SWAGGER_API_CURRENT_VERSION)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup(SWAGGER_API_ROOT, app, document);

  app.enableCors();
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'script-src-attr': ["'unsafe-inline'"],
      },
    },
  });
  await app.register(fastifyRateLimiter, {
    max: 100,
    timeWindow: '1 minute',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = 9100; // e2e fault: ignores PORT
  await app.listen(port, '0.0.0.0');

  Logger.log(
    `Application is running on: http://localhost:${port}/${SWAGGER_API_ROOT}`,
    'Bootstrap',
  );
}

bootstrap();
