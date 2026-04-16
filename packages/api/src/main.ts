import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import { createLogger } from '@clawix/shared';
import { AppModule } from './app.module.js';
import { registerSecurityPlugins } from './common/security.config.js';

const logger = createLogger('api');

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
    }),
    {
      logger: {
        log: (message: string) => {
          logger.info(message);
        },
        error: (message: unknown, trace?: string) => {
          if (message instanceof Error) {
            logger.error({ err: message, trace }, message.message);
          } else {
            logger.error({ trace }, String(message));
          }
        },
        warn: (message: string) => {
          logger.warn(message);
        },
        debug: (message: string) => {
          logger.debug(message);
        },
        verbose: (message: string) => {
          logger.trace(message);
        },
      },
    },
  );

  // Security plugins must be registered BEFORE Swagger routes
  await registerSecurityPlugins(app);

  // Register multipart plugin for file uploads
  await app
    .getHttpAdapter()
    .getInstance()
    .register(multipart as any, {
      limits: {
        fileSize: Number(process.env['WORKSPACE_UPLOAD_MAX_SIZE'] ?? 50 * 1024 * 1024), // 50 MB default
      },
    });

  if (process.env['NODE_ENV'] !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Clawix API')
      .setDescription('Enterprise-grade multi-agent AI orchestration platform')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  const port = Number(process.env['PORT'] ?? 3001);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await app.listen(port, host);
  logger.info(`API server listening on ${host}:${port}`);
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start API server');
  process.exit(1);
});
