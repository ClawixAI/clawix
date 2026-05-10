#!/usr/bin/env bash
set -euo pipefail

echo "=== Clawix Development Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is required but not installed. Run: npm install -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Warning: Docker not found. You won't be able to run local infrastructure."; }

# Check Node.js version
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js 20+ is required. Current version: $(node --version)"
  exit 1
fi

echo "Node.js $(node --version) - OK"
echo "pnpm $(pnpm --version) - OK"

# Copy .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example - please update with your API keys"
else
  echo ".env already exists - skipping"
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Build shared package first (other packages depend on it)
echo "Building shared package..."
pnpm --filter @clawix/shared run build

# Start local infrastructure
if command -v docker >/dev/null 2>&1; then
  echo "Starting local infrastructure (Postgres, Redis, pgAdmin)..."
  docker build -t clawix-agent:latest -f infra/docker/agent/Dockerfile .
  docker build -t clawix-python-runner:latest infra/docker/python-runner
  docker compose -f docker-compose.dev.yml up -d

  echo "Waiting for services to be healthy..."
  sleep 5

  echo "Infrastructure ready:"
  echo "  Postgres: localhost:5432"
  echo "  Redis:    localhost:6379"
  echo "  pgAdmin:  http://localhost:5050"
fi

echo ""
echo "=== Setup Complete ==="
echo "Run 'pnpm run dev' to start the development servers."
