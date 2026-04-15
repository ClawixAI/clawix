// Production prisma.config.ts — reads DATABASE_URL from environment (no dotenv needed)
// Paths are relative to /app in the production container
export default {
  schema: '/app/prisma/schema.prisma',
  migrations: {
    path: '/app/prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
};
