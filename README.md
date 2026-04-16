<p align="center">
  <h1 align="center">Clawix</h1>
  <p align="center">
    <strong>Self-hosted multi-agent AI orchestration platform</strong>
    <br />
    Run AI agent swarms in isolated containers. Full governance. Zero vendor lock-in.
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue`?style=flat-square" alt="License"></a>
    <a href="https://github.com/clawix/clawix/stargazers"><img src="https://img.shields.io/github/stars/clawix/clawix?style=flat-square" alt="Stars"></a>
    <a href="https://github.com/clawix/clawix/issues"><img src="https://img.shields.io/github/issues/clawix/clawix?style=flat-square" alt="Issues"></a>
    <a href="https://github.com/clawix/clawix/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome"></a>
    <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node.js"></a>
    <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square" alt="TypeScript"></a>
  </p>
</p>

---

## Why Clawix?

Most AI agent frameworks are either **toys** (single-process, no isolation, no audit trail) or **walled gardens** (cloud-only, per-seat pricing, your data on someone else's servers).

Clawix sits in between: **production-grade orchestration you own entirely.**

- **Every agent runs in its own Docker container** -- no agent can read another's files, exhaust your host's memory, or escape its sandbox.
- **Plug in any LLM** -- Claude and GPT-4 today, with Azure, DeepSeek, Gemini, and OpenRouter coming soon. Any OpenAI-compatible endpoint (Ollama, vLLM, etc.) works now via the custom provider.
- **Built for teams** -- RBAC, token budgets, audit logs, and scoped memory mean you can hand agents to your whole org without losing sleep.
- **Reach users where they are** -- Telegram, WhatsApp, Slack, and a built-in web dashboard. One agent, many channels.

> Think of it as "Kubernetes for AI agents" -- container isolation, resource limits, health checks, and warm pools, but purpose-built for LLM workloads.

---

## Features

<table>
<tr>
<td width="50%">

### Container-Isolated Agents

Every agent gets its own sandboxed Docker container with CPU/memory limits, read-only mounts, and no root access. Cross-agent interference is architecturally impossible.

### Warm Container Pool

Primary agents stay warm in pre-provisioned containers. Cold-start latency drops from **1-3 seconds to ~50ms**.

### Swarm Orchestration

Break complex tasks into sub-agent DAGs. The coordinator delegates, aggregates results, and handles failures -- all within isolated containers.

</td>
<td width="50%">

### Multi-Provider AI

Anthropic and OpenAI out of the box, with Azure, DeepSeek, Gemini, and OpenRouter planned. Any OpenAI-compatible endpoint already works via the custom provider. Add new providers with a single config entry.

### Scoped Memory System

Persistent memory at three levels: private (per-user), group (team), and org-wide. Agents build context over time without re-prompting.

### Skills Framework

Pluggable tools with approval workflows. Bundle built-in skills, create custom ones at runtime, or use the built-in skill-creator agent to generate new skills from natural language.

</td>
</tr>
</table>

### And also...

- **Governance & Compliance** -- Token budgets per user/group, immutable audit logs, structured logging (Pino), Prometheus metrics
- **Multi-Channel Delivery** -- reach users across messaging platforms and web (see table below)
- **Per-User Workspaces** -- Persistent directories that survive container teardown, with quota enforcement
- **Encrypted Secrets** -- Provider API keys stored with AES-256-GCM; encryption key never leaves your server
- **RBAC** -- Role-based access control across all management APIs

---

## Architecture

```
                        ┌──────────────────────────────────────────┐
                        │            User Interfaces               │
                        │   Telegram  WhatsApp  Slack  Web UI      │
                        └──────────────────┬───────────────────────┘
                                           │
                        ┌──────────────────▼───────────────────────┐
                        │             API Gateway                   │
                        │   NestJS + Fastify  │  JWT  │  Rate Limit │
                        └──────────────────┬───────────────────────┘
                                           │
              ┌────────────────────────────▼────────────────────────────┐
              │                     Core Engine                         │
              │                                                         │
              │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
              │  │  Reasoning  │  │    Tool       │  │    Swarm      │  │
              │  │   Loops     │  │  Execution    │  │ Coordinator   │  │
              │  └─────────────┘  └──────────────┘  └───────────────┘  │
              │                                                         │
              │  Providers: Claude │ GPT │ OpenAI-compatible │ Custom   │
              └────────────────────────────┬───────────────────────────┘
                                           │
              ┌────────────────────────────▼────────────────────────────┐
              │                  Container Pool                         │
              │  ┌──────────┐  ┌──────────────┐  ┌─────────────────┐   │
              │  │  Warm     │  │  Ephemeral   │  │  Resource       │   │
              │  │  Primary  │  │  Sub-Agents  │  │  Limits         │   │
              │  └──────────┘  └──────────────┘  └─────────────────┘   │
              └────────────────────────────┬───────────────────────────┘
                                           │
              ┌────────────────────────────▼────────────────────────────┐
              │                    Data Layer                            │
              │        PostgreSQL  │  Redis  │  User Workspaces         │
              └─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js 20+** and **pnpm 9+**
- **Docker** (for agent containers, PostgreSQL, and Redis)

### 1. Clone & Install

```bash
git clone https://github.com/clawix/clawix.git
cd clawix

# One-command setup (installs deps, copies .env, starts infra)
./scripts/setup-dev.sh
```

<details>
<summary>Manual setup (click to expand)</summary>

```bash
pnpm install
cp .env.example .env
pnpm --filter @clawix/shared run build
docker build -t clawix-agent:latest -f infra/docker/agent/Dockerfile .
docker compose -f docker-compose.dev.yml up -d
```

</details>

### 2. Configure

Edit `.env` with your API keys:

```bash
# Required: encryption key for provider secrets (AES-256-GCM)
PROVIDER_ENCRYPTION_KEY=$(openssl rand -hex 32)

# AI providers (used by db:seed; also env fallback at runtime)
ANTHROPIC_API_KEY=sk-ant-xxx        # Claude
OPENAI_API_KEY=sk-xxx               # GPT (optional)

# Channels (optional -- used by db:seed to populate channel config)
TELEGRAM_BOT_TOKEN=123456789:ABCdef...   # Telegram (from @BotFather)

# Database (defaults work with docker-compose)
DATABASE_URL="postgresql://clawix:clawix_dev@localhost:5433/clawix"
REDIS_URL="redis://localhost:6379"
```

### 3. Run

```bash
pnpm run dev    # API on :3001, Dashboard on :3000
```

That's it. Open `http://localhost:3000` or message your Telegram bot.

---

## Multi-Provider Support

Built-in providers plus extensible registry -- add new ones with a single `ProviderSpec` entry:

| Provider        | Detection                                  | Use Case              | Status    |
| --------------- | ------------------------------------------ | --------------------- | --------- |
| **Anthropic**   | model starts with `claude-`                | Primary (best tools)  | Available |
| **OpenAI**      | model starts with `gpt-`/`o1-`/`o3-`/`o4-` | General purpose       | Available |
| **Z.AI Coding** | model starts with `glm-`                   | GLM models            | Available |
| **Azure**       | config key `azure_openai`                  | Enterprise compliance | Planned   |
| **DeepSeek**    | model starts with `deepseek-`              | Cost-effective        | Planned   |
| **Gemini**      | model starts with `gemini-`                | Google ecosystem      | Planned   |
| **Kimi**        | model starts with `moonshot-`              | Long-context tasks    | Planned   |
| **OpenRouter**  | API key starts with `sk-or-`               | Provider gateway      | Planned   |
| **Custom**      | any OpenAI-compatible endpoint             | Ollama, vLLM, etc.    | Available |

## Channels

| Channel           | Integration         | Use Case                      | Status    |
| ----------------- | ------------------- | ----------------------------- | --------- |
| **Telegram**      | grammY              | Personal & team chat          | Available |
| **WhatsApp**      | Business API        | Customer-facing agents        | Planned   |
| **Slack**         | Bolt SDK            | Workspace collaboration       | Planned   |
| **Web Dashboard** | Next.js + WebSocket | Admin console & conversations | Available |

---

## Security Model

Clawix follows a **zero-trust architecture** for agent execution:

| Threat                         | Mitigation                                                     |
| ------------------------------ | -------------------------------------------------------------- |
| Cross-user data access         | Workspaces only mounted into owner's container                 |
| Sub-agent privilege escalation | Sub-agents get read-only curated context, never full workspace |
| Memory poisoning               | Agent context regenerated from DB each run                     |
| Disk exhaustion                | Per-user quota enforcement (default 500 MB)                    |
| Path traversal                 | All paths validated to stay under `data/org/`                  |
| Secret leakage                 | API keys encrypted at rest (AES-256-GCM)                       |
| Untrusted code execution       | All agent code runs inside sandboxed containers, never on host |

---

## Tech Stack

| Layer      | Technology                                                |
| ---------- | --------------------------------------------------------- |
| API        | NestJS 11 + Fastify                                       |
| Frontend   | Next.js 15 + Tailwind CSS + shadcn/ui                     |
| AI         | Multi-provider (Anthropic, OpenAI, any OpenAI-compatible) |
| Database   | Prisma ORM + PostgreSQL 16                                |
| Cache      | Redis 7 (ioredis)                                         |
| Auth       | NextAuth (JWT + OAuth2)                                   |
| Containers | Docker CLI with resource limits                           |
| Logging    | Pino (structured JSON)                                    |
| Metrics    | Prometheus (prom-client)                                  |
| Testing    | Vitest + Playwright                                       |
| Monorepo   | pnpm workspaces                                           |

---

## Project Structure

```
clawix/
├── packages/
│   ├── api/          # NestJS API server (auth, engine, channels, skills)
│   ├── web/          # Next.js dashboard (React 19, Tailwind, shadcn/ui)
│   ├── shared/       # Shared types, schemas, utilities, logger
│   └── worker/       # Background job processor
├── skills/
│   └── builtin/      # Bundled skills (web_search, file_ops, etc.)
├── infra/
│   └── docker/       # Agent container Dockerfile
├── prisma/           # Database schema + migrations
├── docs/             # Architecture & implementation docs
└── scripts/          # Dev/ops scripts
```

---

## Commands

```bash
pnpm run dev              # Start API + dashboard (hot-reload)
pnpm run build            # Build all packages
pnpm run test             # Run all tests
pnpm run test:coverage    # Tests with coverage report
pnpm run lint             # ESLint + type check
pnpm run format           # Prettier format

# Infrastructure
pnpm run docker:dev       # Start Postgres, Redis, pgAdmin
pnpm run docker:down      # Stop local infra

# Database
pnpm run db:migrate       # Run Prisma migrations
pnpm run db:seed          # Seed initial data
pnpm run db:studio        # Open Prisma Studio (GUI)
```

---

## Roadmap

- [x] Container-isolated agent execution
- [x] Multi-provider AI support (Claude, GPT, OpenAI-compatible endpoints)
- [ ] First-class Azure, DeepSeek, Gemini, Kimi, OpenRouter providers
- [x] Warm container pool (~50ms cold start)
- [x] Swarm orchestration with DAG dependencies
- [x] Telegram channel integration
- [x] Scoped memory system
- [x] Skills framework with built-in skill creator
- [ ] WhatsApp Business API integration
- [ ] Slack integration
- [x] Web dashboard (conversations, agents, skills, settings)
- [ ] Skill marketplace UI
- [ ] Advanced token analytics & optimization
- [ ] Multi-region deployment support

---

## Contributing

Contributions are welcome! Whether it's bug fixes, new features, documentation, or feedback -- we'd love your help.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/clawix.git
cd clawix

# Create a feature branch
git checkout -b feature/your-feature

# Make changes, then test and lint
pnpm run test
pnpm run lint

# Commit with conventional commits
git commit -m "feat: add amazing feature"

# Push and open a PR
git push origin feature/your-feature
```

**Guidelines:**

- TypeScript strict mode -- no `any`
- Write tests for new features (Vitest)
- Follow conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
- Keep files under 400 LOC
- Never commit secrets or API keys

---

## Security

If you discover a security vulnerability, please report it responsibly via [GitHub Security Advisories](https://github.com/clawix/clawix/security/advisories) instead of using the public issue tracker.

---

## Acknowledgments

Clawix builds on ideas from:

- [nanoClaw](https://github.com/qwibitai/nanoclaw) -- Container-isolated agent execution
- [nanobot](https://github.com/HKUDS/nanobot) -- Multi-provider AI design patterns

---

## License

MIT -- see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built for organizations that need AI agents they can actually trust.</sub>
</p>
