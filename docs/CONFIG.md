# Configuration Reference

A single-page reference for every configurable area in Clawix. Each section shows the UI, lists the key fields, and links to the dedicated guide for full detail.

All settings pages are under **Settings** in the left sidebar and are accessible only to users with the **Admin** role.

---

## Table of Contents

1. [Policies](#1-policies)
2. [Channels](#2-channels)
3. [Providers](#3-providers)
4. [Agents](#4-agents)
5. [Memory](#5-memory)
6. [Skills](#6-skills)

---

## 1. Policies

**Path:** Settings → Policies (`/settings/policies`)  
**Full guide:** [AGENTS.md](./AGENTS.md) → Policy enforcement section

A **Policy** is the governance contract assigned to each user. It controls exactly what that user — and their agents — are permitted to do: how many tokens they may spend per month, which AI providers they may access, how many agents and skills they can run, and whether scheduled tasks are available.

Every user is assigned exactly one Policy. Changing a user's Policy takes effect immediately.

![Policies page — three policies: Unrestricted, Extended, Standard](./assets/policies-overview.png)

### Policies table columns

| Column           | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| **Policy**       | Policy name and description                                     |
| **Token Budget** | Monthly spending cap in USD (`Unlimited` or `$X.XX/mo`)         |
| **Agents**       | Max number of active agents the user can run concurrently       |
| **Providers**    | Provider IDs the user's agents are allowed to call (badge list) |
| **Active**       | Toggle — inactive policies prevent users from running agents    |

### Creating a Policy

Click **+ Create Policy** in the top-right corner.

![Create Policy dialog — all fields](./assets/policies-create.png)

| Field                       | Description                                                   | Default   |
| --------------------------- | ------------------------------------------------------------- | --------- |
| **Name**                    | Unique policy name (e.g. "Standard", "Pro")                   | —         |
| **Description**             | Short human-readable summary                                  | —         |
| **Token Budget (cents/mo)** | Monthly token spend cap in USD cents. Empty = unlimited       | unlimited |
| **Max Agents**              | Concurrent agent limit for users on this policy               | 5         |
| **Max Skills**              | Maximum custom skills the user can create                     | 10        |
| **Max Memory Items**        | Maximum database memory items the user can store              | 1 000     |
| **Max Groups Owned**        | Groups the user can create and own                            | 5         |
| **Allowed Providers**       | Checkboxes — which provider IDs agents on this policy may use | all       |
| **Enable cron scheduling**  | Whether scheduled tasks (`schedule_task` tool) are available  | off       |
| **Max Tasks**               | Max scheduled tasks when cron is enabled                      | 5         |
| **Min Interval (s)**        | Minimum seconds between cron task executions                  | 300       |
| **Max Tokens/Run**          | Per-run token cap for cron-triggered agent runs               | unlimited |

### Editing a Policy

Click **⋯** on any policy row → **Edit**.

![Policy row action menu — Edit and Delete](./assets/policies-action-menu.png)

![Edit Policy dialog — all fields pre-filled for Unrestricted policy](./assets/policies-edit.png)

All fields are editable. Changes apply to all users currently on that policy without reassignment.

> **Warning:** Reducing limits on an active policy (e.g. lowering `maxAgents` or removing a provider) affects users immediately. Agents currently running are not cancelled mid-run, but new runs will be blocked if the limit is exceeded.

### Deleting a Policy

Click **⋯** → **Delete**. A policy can only be deleted if no users are currently assigned to it. Reassign all users to another policy first.

### Assigning a Policy to a User

Policies are assigned per user in **Settings → Users**. Select a user → edit → choose Policy from the dropdown.

---

## 2. Channels

**Path:** Settings → Channels (`/settings/channels`)  
**Full guide:** _(this section — channels have no separate guide yet)_

A **Channel** is a configured integration that allows external messaging platforms to communicate with Clawix agents. When a message arrives on a connected channel, it is routed to the primary agent assigned to that user and a conversation session is created.

![Channels page — Telegram Bot and Web Dashboard, both connected](./assets/channels-overview.png)

### Channels table columns

| Column      | Meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| **Channel** | Channel name with type icon                                                              |
| **Type**    | `Telegram`, `Web`, `Slack`, or `WhatsApp`                                                |
| **Status**  | `connected` (green) or `error` / `disconnected`                                          |
| **Enabled** | Toggle — disabling a channel stops it receiving new messages without removing the config |

### Supported channel types

| Type         | Use case                                           | Required credentials                              |
| ------------ | -------------------------------------------------- | ------------------------------------------------- |
| **Telegram** | Bot receives messages from Telegram users          | Bot Token from @BotFather                         |
| **Web**      | Built-in web chat widget / dashboard conversations | None — always available                           |
| **Slack**    | Slash commands and DMs via Slack Bolt              | App credentials (OAuth)                           |
| **WhatsApp** | Production messaging via WhatsApp Business API     | WhatsApp Business API via @whiskeysockets/baileys |

### Adding a Channel

Click **+ Add Channel** in the top-right corner. Select the channel type first — the form fields change accordingly.

#### Telegram

![Add Channel dialog — Telegram type with Bot Token and Mode fields](./assets/channels-add-telegram.png)

| Field         | Description                                                                   |
| ------------- | ----------------------------------------------------------------------------- |
| **Type**      | `Telegram`                                                                    |
| **Name**      | Display name for this channel entry                                           |
| **Bot Token** | Token from [@BotFather](https://t.me/BotFather) — format: `123456:ABC-DEF...` |
| **Mode**      | `Polling` (Clawix polls Telegram) or `Webhook` (Telegram pushes to your URL)  |

> Use **Polling** for local development. Use **Webhook** in production (requires a publicly reachable HTTPS URL set in `TELEGRAM_WEBHOOK_URL`).

#### Web

![Add Channel dialog — Web type with progress and tool-call options](./assets/channels-add-web.png)

| Field                       | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| **Type**                    | `Web`                                                            |
| **Name**                    | Display name for this channel entry                              |
| **Enable progress updates** | Stream intermediate agent messages to the browser as they arrive |
| **Enable tool call hints**  | Show tool-call summaries in the chat UI during agent execution   |

### Configuring an Existing Channel

Click **⋯** on a channel row → **Configure**.

![Channel row action menu — Configure and Remove](./assets/channels-action-menu.png)

![Configure Channel dialog — pre-filled fields for Telegram Bot](./assets/channels-edit.png)

All fields shown at creation are editable. The channel type is fixed after creation — to change type, remove and re-add.

### Enabling and Disabling a Channel

Use the **Enabled** toggle in the table row. A disabled channel retains its configuration but ignores all incoming messages. Useful for temporary maintenance without losing credentials.

### Removing a Channel

Click **⋯** → **Remove**. This permanently deletes the channel record and its configuration. Active sessions from this channel are not terminated, but no new sessions will start.

---

## 3. Providers

**Path:** Settings → Providers (`/settings/providers`)  
**Full guide:** [PROVIDERS.md](./PROVIDERS.md)

A **Provider** is a configured connection to an AI language model service (Anthropic, OpenAI, Z.AI Coding, or a custom OpenAI-compatible endpoint). Providers store encrypted API keys and endpoint overrides. Agents reference a provider by ID; the Core Engine resolves the key at runtime.

![Providers page — OpenAI listed as the default provider](./assets/providers-overview.png)

### Key fields at a glance

| Field           | Notes                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Provider ID** | Lowercase, hyphens only. Unique. Read-only after creation.                  |
| **API Key**     | Encrypted at rest (AES-256-GCM). Shown masked (`sk-***...r00A`).            |
| **Base URL**    | Optional endpoint override. Required for custom/private models.             |
| **Default**     | ★ badge — one provider only. Used when an agent doesn't specify a provider. |
| **Enabled**     | Toggle. Disabled providers are skipped; agents fall back to env var.        |

### Adding a Provider

Click **+ Add Provider** → select type → enter API Key → optionally set Base URL and default flag.

![Add Provider dialog — provider type dropdown](./assets/providers-add-form.png)

![Add Provider dialog — Anthropic selected](./assets/providers-add-anthropic.png)

### Editing a Provider

Click **⋯** → **Edit**. API Key field: leave blank to keep the existing key; enter a new value to rotate it.

![Provider action menu — Edit and Remove](./assets/providers-action-menu.png)

![Edit Provider dialog — pre-filled fields](./assets/providers-edit-dialog.png)

### Built-in provider types

| Provider ID  | Models                                                     | Env seed var         |
| ------------ | ---------------------------------------------------------- | -------------------- |
| `anthropic`  | `claude-opus-4-*`, `claude-sonnet-4-*`, `claude-haiku-4-*` | `ANTHROPIC_API_KEY`  |
| `openai`     | `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `o3`, `codex-*`        | `OPENAI_API_KEY`     |
| `zai-coding` | `glm-*`                                                    | `ZAI_CODING_API_KEY` |
| `gemini`     | `gemini-3-pro-preview`, `gemini-3-flash-preview`, etc.     | `GEMINI_API_KEY`     |
| `kimi-code`  | (various)                                                  | `KIMI_CODE_API_KEY`  |
| `custom`     | Any (OpenAI-compatible) — Base URL required                | —                    |

→ **Full detail:** [PROVIDERS.md](./PROVIDERS.md)

---

## 4. Agents

**Path:** Agents (`/agents/user-agents`)  
**Full guide:** [AGENTS.md](./AGENTS.md)

**Agents** are the AI workers in Clawix. Two roles exist:

- **Primary** (`role: primary`) — the user-facing conversational agent. One per user. Stateful, loads history, has access to the spawn tool.
- **Worker / Sub-agent** (`role: worker`) — a specialised, stateless agent spawned by the primary to handle parallel sub-tasks. Multiple per user.

![Agents page — Public Agents table with primary and worker roles, My Sub-Agents, Recent Agent Runs](./assets/agents-overview.png)

### Creating a Public (Primary) Agent

Click **+ Create Agent**. Admin only.

![Create Public Agent dialog — Name, Description, System Prompt, Provider, Model, API Base URL, Max Tokens](./assets/agents-create-public.png)

### Creating a Sub-Agent

Click **+ Create Sub-Agent** in the My Sub-Agents section.

![Create Sub-Agent dialog — same fields, role fixed to worker](./assets/agents-create-subagent.png)

### Editing an Agent

Click **⋯** on any agent row → **Edit**.

![Agent action menu — Edit and View Runs](./assets/agents-action-menu.png)

![Edit Agent dialog — Name, Description, System Prompt, Role (read-only), Provider, Model, Max Tokens](./assets/agents-edit-dialog.png)

![Edit Agent dialog — bottom showing Save button](./assets/agents-edit-dialog-bottom.png)

### Agent field summary

| Field              | Primary   | Sub-Agent | Notes                                           |
| ------------------ | --------- | --------- | ----------------------------------------------- |
| **Name**           | ✓         | ✓         | Used by spawn tool to reference workers by name |
| **System Prompt**  | ✓         | ✓         | 1–50 000 chars. Core behaviour definition.      |
| **Provider**       | ✓         | ✓         | Must match a configured enabled Provider        |
| **Model**          | ✓         | ✓         | Must be compatible with the selected provider   |
| **Max Tokens/Run** | ✓         | ✓         | Hard cap; default 100 000                       |
| **Role**           | `primary` | `worker`  | Read-only after creation                        |

→ **Full detail:** [AGENTS.md](./AGENTS.md)

---

## 5. Memory

**Path:** Workspace (`/workspace`)  
**Full guide:** [MEMORY.md](./MEMORY.md)

**Memory** is the persistent context injected into the agent's system prompt before every run. It is a four-layer system — not a single file.

| Layer             | File / Source                      | Injected as                        |
| ----------------- | ---------------------------------- | ---------------------------------- |
| Agent personality | `SOUL.md`                          | Top of system prompt               |
| User profile      | `USER.md`                          | After SOUL.md                      |
| Long-term facts   | `memory/MEMORY.md`                 | `## Long-term Memory` section      |
| Activity journal  | DB items tagged `daily:YYYY-MM-DD` | `## Recent Activity` (last 3 days) |

![Workspace root — memory/, projector/, SOUL.md, USER.md](./assets/memory-workspace-root.png)

### The memory/ folder and MEMORY.md

![memory/ folder containing MEMORY.md](./assets/memory-folder.png)

![MEMORY.md rendered — Coding-standards section](./assets/memory-file-view.png)

`MEMORY.md` is auto-maintained by the agent via `save_memory`. It is formatted as markdown with one section per tag. Max 1 500 tokens injected per run.

### SOUL.md — agent personality

![SOUL.md — Personality, Communication Style, Values](./assets/memory-soul-view.png)

Defines the agent's character and tone. Edit directly in the Workspace file browser. Changes take effect on the next run.

### USER.md — user profile

![USER.md — User Profile with Basic Info, Preferences, Work Context](./assets/memory-user-view.png)

Stores the user's name, preferences, role, and special instructions. Pre-seeded at workspace creation; enriched by the agent over time.

### Public vs private memory

Memory items (database records created by `save_memory`) follow a three-tier visibility model:

```
Private (default) → Group-scoped (share_memory targetType=group) → Org-wide (share_memory targetType=org)
```

Any user can promote a private item to group or org scope using the `share_memory` tool in conversation. Shares are revocable.

### Memory tools (used in conversation)

| Tool            | What it does                                        |
| --------------- | --------------------------------------------------- |
| `save_memory`   | Create or update a memory item with tags            |
| `search_memory` | Search private + group + org memory by text or tags |
| `list_groups`   | Discover available group share targets              |
| `share_memory`  | Share an owned item to a group or the whole org     |

→ **Full detail:** [MEMORY.md](./MEMORY.md)

---

## 6. Skills

**Path:** Skills (`/skills`)  
**Full guide:** [SKILLS.md](./SKILLS.md)

A **Skill** is a filesystem directory (`SKILL.md` + optional scripts/references/assets) that extends an agent's capabilities with reusable, domain-specific knowledge. Skills are injected as a summary index into the agent's system prompt; full content loads on demand.

![Skills page — Built-in Skills (projector-creator, skill-creator) and Your Skills (empty)](./assets/skills-page.png)

### Two tiers

| Tier         | Path                      | Who can modify                          |
| ------------ | ------------------------- | --------------------------------------- |
| **Built-in** | `skills/builtin/`         | Platform only (read-only in containers) |
| **Custom**   | `skills/custom/{userId}/` | The owning user + their agent           |

### Creating a skill via conversation

The recommended way — just describe the skill in plain language in the **Conversations** chat:

![Chat input — "Create a skill for parsing Stripe webhook payloads"](./assets/skills-chat-create-typed.png)

![Agent confirmation — skill created at /workspace/stripe-webhook-parser/ with SKILL.md and parser.py](./assets/skills-chat-created.png)

Or use the `/skill-creator` slash command from the command palette:

![Slash command palette — /projector-creator, /skill-creator, /reset, /compact, /help](./assets/skills-slash-command.png)

### Using a skill

Reference a skill by name explicitly, or let the agent match it automatically from the summary index:

![Agent using the stripe-webhook-parser skill — reads SKILL.md, runs parser.py, returns structured output](./assets/skills-chat-use-response.png)

### Skill structure

```
skill-name/
├── SKILL.md          ← Required. Frontmatter (name, description, version, tags) + instructions.
├── scripts/          ← Executable code run inside the container
├── references/       ← Documentation loaded into context on demand
└── assets/           ← Templates and output files referenced by path
```

### SKILL.md frontmatter fields

| Field         | Required | Notes                                                                         |
| ------------- | -------- | ----------------------------------------------------------------------------- |
| `name`        | Yes      | Must match the directory name. `^[a-z0-9]+(-[a-z0-9]+)*$`, max 64 chars       |
| `description` | Yes      | The trigger signal — what the skill does AND when to use it. Max 1 024 chars. |
| `version`     | No       | Semantic version string                                                       |
| `tags`        | No       | Categorisation tags                                                           |

→ **Full detail:** [SKILLS.md](./SKILLS.md)

---

## Configuration Dependency Map

```
Policies ──────────────────────────────────────────────────────────┐
│  allowedProviders → restricts which Providers agents may use  │
│  maxAgents        → limits concurrent agent runs              │
│  maxMemoryItems   → caps memory DB quota per user             │
│  maxSkills        → caps custom skill count per user          │
│  cronEnabled      → gates the schedule_task memory tool       │
└───────────────────────────────────────────────────────────────┘
         ↓ assigned to Users
Users ──→ Agents (primary + worker)
              ↓ references
         Providers  (resolved at runtime, encrypted API key)
              ↓ used by
         Core Engine → reads Memory → reads Skills
              ↓ responds via
         Channels (Telegram · Web · Slack · WhatsApp)
```

When adding a new provider, also check that the relevant Policies have it in **Allowed Providers** — otherwise agents on restricted policies will fail at runtime even if the provider is enabled.

---

## Settings Navigation Quick Reference

| Page               | Sidebar path          | Who can access                                            |
| ------------------ | --------------------- | --------------------------------------------------------- |
| Policies           | Settings → Policies   | Admin                                                     |
| Channels           | Settings → Channels   | Admin                                                     |
| Providers          | Settings → Providers  | Admin                                                     |
| Users              | Settings → Users      | Admin                                                     |
| Agents             | Agents (top-level)    | Admin (create/edit public); all users (create sub-agents) |
| Workspace / Memory | Workspace (top-level) | All users (own workspace only)                            |
| Skills             | Skills (top-level)    | All users (own custom skills)                             |
