import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet, { type FastifyHelmetOptions } from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';

/**
 * Build helmet options with CSP tuned for a JSON API.
 *
 * In production, CSP is strict (default-src 'none') and COEP is enabled.
 * In development, CSP allows 'unsafe-inline' for Swagger UI.
 */
export function buildHelmetOptions(): FastifyHelmetOptions {
  const isProduction = process.env['NODE_ENV'] === 'production';

  return {
    contentSecurityPolicy: {
      directives: isProduction
        ? {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
          }
        : {
            defaultSrc: ["'none'"],
            // Swagger UI requires inline scripts and styles
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
          },
    },
    // COEP: enabled in production (no Swagger), disabled in dev (breaks Swagger UI)
    crossOriginEmbedderPolicy: isProduction,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 31_536_000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  };
}

/**
 * Build CORS options from environment.
 * Reads CORS_ALLOWED_ORIGINS (comma-separated).
 * Rejects wildcard '*' when credentials are enabled.
 */
export function buildCorsOptions() {
  const raw = process.env['CORS_ALLOWED_ORIGINS'] ?? 'http://localhost:3000';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    throw new Error("CORS_ALLOWED_ORIGINS must not contain '*' when credentials are enabled");
  }

  return {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-ID', 'If-Match'],
    exposedHeaders: [
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'ETag',
    ],
    credentials: true,
    maxAge: 86_400, // preflight cache 24h (Chrome caps at 2h, Firefox at 24h)
  };
}

/**
 * Register security plugins on the Fastify instance.
 * Must be called BEFORE SwaggerModule.setup() and app.listen()
 * so that security headers apply to all routes including Swagger.
 */
export async function registerSecurityPlugins(app: NestFastifyApplication): Promise<void> {
  // Cast through unknown to handle minor fastify version type mismatch
  // between @fastify/helmet peer dep (5.7.x) and project fastify (5.8.x)
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.register(helmet, buildHelmetOptions());
  await fastify.register(cors, buildCorsOptions());
  await fastify.register(cookie);
}
