#!/bin/sh
set -e

# Wait for database to be ready (simple retry loop)
echo "Waiting for database..."
until node -e "
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.connect().then(() => { client.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "Database not ready, retrying in 2s..."
  sleep 2
done
echo "Database is ready!"

# Run migrations
echo "Running database migrations..."
cd /app
npx prisma migrate deploy --schema=prisma/schema.prisma
echo "Migrations complete!"

# Bootstrap initial admin + baseline config (idempotent; silent no-op when
# INITIAL_ADMIN_EMAIL is unset).
if [ -f /app/dist/bootstrap.js ]; then
  echo "Running bootstrap..."
  node /app/dist/bootstrap.js
fi

# Start the application
echo "Starting Clawix API..."
exec node dist/main.js
