# Clawix

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-blue)](package.json)

**Enterprise-grade, self-hosted multi-agent AI orchestration platform.**

Clawix lets you securely run AI-powered agents in isolated containers, coordinate swarms of specialized agents for complex tasks, and maintain full governance with token tracking and audit logs. Built for organizations that need auditable, scalable AI deployments across multiple channels.

## Key Features

- **Multi-Provider AI** - Anthropic, OpenAI, Z.AI Coding, Gemini, Kimi-code, and custom endpoints
- **Container Isolation** - Every agent runs in a sandboxed Docker container with resource limits
- **Warm Container Pool** - Eliminates cold-start latency for primary agents (1-3s → ~50ms)
- **Swarm Orchestration** - Delegate complex tasks to specialized sub-agents with DAG dependencies
- **Multi-Channel** - Telegram, WhatsApp, Slack, and Web Dashboard
- **Memory System** - Persistent, scoped memory (private, group, org-wide) with write-back
- **Skills Framework** - Pluggable tools with approval workflows
- **Governance** - Token budgets, audit logs, RBAC, rate limiting
- **Self-Hosted** - Full control over your data and infrastructure

## Quick Start

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js 20+](https://nodejs.org/)
- [pnpm 9+](https://pnpm.io/installation) (`npm install -g pnpm`)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (user-friendly platform for container management)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/jasonli0226/clawix.git
cd clawix

# 2. Prepare your environment file
cp .env.example .env
# Edit .env — set at least one AI provider key:
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, or ZAI_CODING_API_KEY
# (The installer will guide you through all required values interactively
#  if you prefer to skip manual editing)

# 3. Run the interactive installer
pnpm run install:clawix
```

The installer will:

1. Check prerequisites (Node 20+, pnpm, Docker, Docker Compose)
2. Ask for deployment mode (production / development), AI provider + API key, admin email/password (production only), and optional Telegram bot token
3. Generate secrets in `.env` — cryptographically random `JWT_SECRET`, `PROVIDER_ENCRYPTION_KEY`, and `POSTGRES_PASSWORD` (permissions set to `600`)
4. Build `clawix-agent:latest` (the Docker image used for isolated per-task containers)
5. Run `docker compose … up -d --build`
6. Wait for `http://localhost:3001/health` to become healthy (migrations + bootstrap run inside the API container on first start)

When it finishes, open `http://localhost:3000` and sign in with the admin credentials you entered.

> Re-running `pnpm run install:clawix` on an existing `.env` is safe — it preserves your secrets, skips the prompts, and just rebuilds/restarts. To reconfigure from scratch, delete `.env` and re-run.

### Configuration

Key variables in `.env` (see `.env.example` for the full list):

```bash
# Required: at least one AI provider
ANTHROPIC_API_KEY=sk-ant-xxx     # Claude models
OPENAI_API_KEY=sk-xxx            # GPT models
ZAI_CODING_API_KEY=xxx           # Z.AI Coding Plan (glm-4.7)

DEFAULT_PROVIDER=openai          # anthropic | openai | zai-coding | custom
DEFAULT_LLM_MODEL=gpt-4o

# Required: encryption key for stored provider keys (AES-256-GCM)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
PROVIDER_ENCRYPTION_KEY=<64-char-hex-string>

# Required in production
JWT_SECRET=change-me-in-production
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Optional: Telegram channel
TELEGRAM_BOT_TOKEN=123456789:ABCdef...

# Database (defaults work for docker-compose dev)
DATABASE_URL="postgresql://clawix:clawix_dev@localhost:5433/clawix"
REDIS_URL="redis://localhost:6379"
```

### Updates and restarts

```bash
pnpm run update:clawix              # rebuild + restart (default)
pnpm run update:clawix -- --pull    # git pull --ff-only, then rebuild + restart
pnpm run update:clawix -- --no-build # plain restart, reuse existing images
```

The updater reads `CLAWIX_DEPLOY_MODE` from `.env` and picks the right compose file automatically. Prisma migrations and the idempotent bootstrap run inside the container on every start.

### Under the hood

- `infra/docker/api/entrypoint.sh` runs `prisma migrate deploy`, then `node dist/bootstrap.js`.
- `bootstrap.ts` only writes when the admin doesn't already exist (uses `upsert` / guarded `create` — never deletes data).
- The production compose file **fails fast** at `docker compose up` time if any of `POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, or `PROVIDER_ENCRYPTION_KEY` are missing.

### Manual setup (no installer)

```bash
cp .env.example .env
# edit .env — set POSTGRES_PASSWORD, JWT_SECRET, CORS_ALLOWED_ORIGINS,
# PROVIDER_ENCRYPTION_KEY, DEFAULT_PROVIDER, <PROVIDER>_API_KEY,
# INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_NAME

docker build -t clawix-agent:latest -f infra/docker/agent/Dockerfile .
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs api | grep '\[bootstrap\]'
```

### Uninstallation

Remove Clawix completely:

```bash
pnpm run uninstall:clawix               # preserve host data
pnpm run uninstall:clawix -- --full     # complete removal
```

| Flag            | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `--full` / `-f` | Remove Docker resources AND host data (.env, ./data/, ./skills/custom/) |
| `--yes` / `-y`  | Skip confirmation prompt                                                |

**What gets removed:**

- **Docker cleanup (default):** containers, images, named volumes from both dev and prod environments
- **Host data (with `--full`):** `.env`, `./data/` (workspaces), `./skills/custom/` (user skills)

**Fresh reinstall:**

```bash
pnpm run uninstall:clawix -- --full -y
pnpm run install:clawix
```

> Without `--full`, host data is preserved. The installer detects existing `.env` and reuses your previous settings.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interfaces                          │
│         Telegram │ WhatsApp │ Slack │ Web Dashboard             │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway                              │
│        NestJS + Fastify │ Auth (JWT) │ Rate Limiting            │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                        Core Engine                              │
│   Reasoning Loops │ Tool Execution │ Swarm Coordinator          │
│   Multi-Provider (Anthropic, OpenAI, Z.AI Coding, Gemini, Kimi-code, Custom)             │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                     Container Pool                              │
│   Warm Primary Agents │ Ephemeral Sub-Agents │ Resource Limits  │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                        Data Layer                               │
│           PostgreSQL │ Redis │ Persistent Workspaces            │
└─────────────────────────────────────────────────────────────────┘
```

## Multi-Provider AI System

Clawix supports multiple AI providers through a unified interface:

| Provider     | Detection                      | Notes                  | Status  |
| ------------ | ------------------------------ | ---------------------- | ------- |
| Anthropic    | model contains "claude"        | Primary provider       | done    |
| OpenAI       | model contains "gpt"           | Fallback               | done    |
| Z.AI Coding  | model contains "glm"           | Z.AI Coding Plan       | done    |
| Gemini       | model contains "gemini"        | Google AI              | done    |
| Kimi-code    | model contains "kimi"          | Moonshot AI            | done    |
| Azure OpenAI | config key "azure_openai"      | Enterprise deployments | planned |
| DeepSeek     | model contains "deepseek"      | Cost-effective         | planned |
| OpenRouter   | API key starts with "sk-or-"   | Gateway                | planned |
| Custom       | any OpenAI-compatible endpoint | vLLM, Ollama, etc.     | done    |

New providers can be added by defining a `ProviderSpec` entry—no code changes needed.

## User Agent & Workspace System

### Core Concepts

- **Primary Agent** - One per user, persistent, maintains session continuity
- **User Workspace** - Persistent directory on host, survives container teardown
- **Sub-Agents** - Shared across org, ephemeral, receive curated read-only context

### Security Model

| Concern                        | Mitigation                                                     |
| ------------------------------ | -------------------------------------------------------------- |
| Cross-user workspace access    | Workspace only mounted into owner's container                  |
| Sub-agent privilege escalation | Sub-agents get read-only curated context, never full workspace |
| Memory poisoning               | CLAUDE.md regenerated from DB each run                         |
| Disk exhaustion                | Per-user quota (default 500 MB)                                |
| Path traversal                 | Workspace paths validated to stay under `data/org/`            |

## Skills Framework

Clawix includes a pluggable skills system:

```
skills/
  builtin/           # Bundled skills (web_search, file_ops, etc.)
  skill-creator/     # Skill for creating new skills
```

Custom skills can be added at runtime. See [docs/SKILLS.md](docs/SKILLS.md) for details.

### Encrypting Secrets

Provider API keys are stored encrypted (AES-256-GCM). If you need to manually insert or update a key in the database, use the encrypt helper:

```bash
# Encrypt a key (reads PROVIDER_ENCRYPTION_KEY from .env)
node scripts/encrypt-secret.mjs "sk-your-api-key"

# Or pipe it
echo "sk-your-api-key" | node scripts/encrypt-secret.mjs
```

The output is the encrypted ciphertext you can insert directly into the `ProviderConfig.apiKey` column.

## Commands

```bash
pnpm run dev            # Start API + dashboard (dev mode)
pnpm run test           # Run all tests (Vitest)
pnpm run test:coverage  # Tests with coverage report
pnpm run lint           # ESLint + type check
pnpm run format         # Prettier format
pnpm run docker:dev     # Start Postgres, Redis, pgAdmin
pnpm run docker:down    # Stop local infra
pnpm run db:migrate     # Run Prisma migrations
pnpm run db:studio      # Open Prisma Studio
```

## Local Infrastructure

| Service  | URL                     | Credentials                  |
| -------- | ----------------------- | ---------------------------- |
| API      | `http://localhost:3001` |                              |
| Web      | `http://localhost:3000` |                              |
| Postgres | `localhost:5433`        | `clawix` / `clawix_dev`      |
| Redis    | `localhost:6379`        |                              |
| pgAdmin  | `http://localhost:5050` | `admin@clawix.dev` / `admin` |

## Tech Stack

- **API:** NestJS 11 + Fastify adapter
- **Frontend:** Next.js 15 + Tailwind CSS + shadcn/ui
- **AI:** Multi-provider (Anthropic, OpenAI, Z.AI Coding, Gemini, Kimi-code, custom)
- **Database:** Prisma + PostgreSQL 16
- **Cache:** Redis 7 (ioredis)
- **Testing:** Vitest + Playwright
- **Monorepo:** pnpm workspaces

## Documentation

- [Architecture Overview](architecture.md)
- [Implementation Plan](docs/implementation-plan/README.md)
- [Getting Started](docs/GETTING_STARTED_TG_TEST.md)
- [Governance](docs/GOVERNANCE.md)

## Project Structure

```
clawix/
├── packages/
│   ├── api/          # NestJS API server (Fastify)
│   ├── web/          # Next.js dashboard
│   └── shared/       # Shared types, schemas, utilities
├── skills/
│   ├── builtin/      # Bundled skills (web_search, file_ops, etc.)
│   └── custom/       # User-defined skills (runtime-loaded)
├── infra/
│   └── docker/       # Dockerfiles (api, web, agent)
├── scripts/          # install.mjs, update.mjs, encrypt-secret.mjs
├── docs/             # Architecture, governance, implementation plan
└── data/             # Persistent volumes (workspaces, Postgres, Redis)
```

## Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm run test`)
5. Run linting (`pnpm run lint`)
6. Commit your changes (conventional commits)
7. Push to your branch
8. Open a Pull Request

### Development Guidelines

- Use TypeScript strict mode
- Write tests for new features
- Follow existing code patterns
- Update documentation as needed
- Never commit secrets or API keys

## Security

If you discover a security vulnerability, please open a [GitHub Security Advisory](https://github.com/jasonli0226/clawix/security/advisories/new) instead of using the public issue tracker.

Security best practices:

- Never run untrusted code outside Docker sandboxes
- Always validate/sanitize inputs before tool calls or DB writes
- Use least-privilege container configs
- Keep API keys and secrets in environment variables

## Roadmap

- [x] WhatsApp Business API integration
- [ ] Slack integration
- [ ] Azure OpenAI provider support
- [ ] DeepSeek provider support
- [ ] OpenRouter gateway support
- [ ] Advanced analytics dashboard
- [ ] Skill marketplace UI
- [ ] Multi-region deployment support
- [ ] Advanced token optimization

See [docs/implementation-plan/README.md](docs/implementation-plan/README.md) for the full phased build plan.

## Acknowledgments

Clawix is inspired by and builds upon ideas from:

- [nanoClaw](https://github.com/qwibitai/nanoclaw) - Container-isolated agent execution
- [nanobot](https://github.com/HKUDS/nanobot) - Multi-provider AI design patterns

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with ❤️ for organizations that need auditable, scalable AI agent deployments.
