# Agents — Guide

## What is a Primary Agent?

A **Primary Agent** (role: `primary`) is the main conversational AI agent assigned to a user. It is the single entry-point through which a user interacts with Clawix. Every user is bound to exactly one primary agent through a **UserAgent** binding that also defines that user's workspace path.

Primary agents are **long-lived and stateful**: they load conversation history from the session, persist every exchange, consolidate memory when context grows large, and maintain a continuous working relationship with the user across multiple conversations.

A primary agent has full access to all available tools:

- **File tools** (exec, read, write, list) — operating inside its Docker container
- **Memory tools** (memory_recall, memory_save, memory_share) — for persistent knowledge
- **Web tools** (web_search, web_fetch) — for external information retrieval
- **Cron tools** (schedule_task, list_tasks, cancel_task) — for scheduled automation
- **Spawn tool** — to delegate tasks to sub-agents

---

## What is a Sub-Agent?

A **Sub-Agent** (role: `worker`) is a specialised, stateless AI agent that a primary agent can spawn to handle a discrete task in parallel. Sub-agents are never invoked directly by a user — they are exclusively called by the primary agent's LLM using the **spawn tool**.

Sub-agents are **short-lived and stateless**: they start with a clean context (no history), execute a single focused task, return their result to the primary agent via an async result queue, and terminate. They share the same workspace as the primary agent but do not persist their own messages to the session.

Each sub-agent definition specifies its own system prompt, provider, model, and token budget — allowing different worker agents to use entirely different models (e.g., a cheap fast model for classification, a powerful model for code generation).

---

## Primary Agent vs Sub-Agent — Key Differences

| Aspect                   | Primary Agent                          | Sub-Agent (Worker)                          |
| ------------------------ | -------------------------------------- | ------------------------------------------- |
| **Role field**           | `primary`                              | `worker`                                    |
| **Invoked by**           | User (via UI or channel)               | Primary agent's spawn tool only             |
| **Conversation history** | Loaded and persisted across sessions   | Clean slate — no history loaded or saved    |
| **Session**              | Creates and owns its Session           | Shares parent's session ID; does not own it |
| **Spawn tool**           | Available                              | Not available (no further spawning)         |
| **Memory tools**         | Available                              | Available                                   |
| **Container**            | Pooled (warm reuse for fast responses) | New container per run (or pool slot)        |
| **Result delivery**      | Direct to user                         | Via Redis async queue → parent re-invoked   |
| **Context enrichment**   | Rich (worker list, memory, docs)       | Minimal (system prompt only)                |
| **Per-user binding**     | Exactly one primary per user           | Multiple workers per user allowed           |
| **Concurrency**          | One active run per session             | Up to 10 concurrent, 100 queued per system  |

---

## Why Use the Primary Agent + Sub-Agent Approach?

This orchestration model delivers significant advantages for complex, real-world tasks:

### Parallelism

A primary agent can spawn multiple sub-agents simultaneously. While the primary agent waits, sub-agents execute concurrently (up to 10 active at once). A research task that would take 10 sequential minutes can complete in 1 minute when split across 10 parallel workers.

### Specialisation

Each sub-agent carries its own **system prompt** and **model**. You can define a `researcher` worker optimised for information gathering, a `coder` worker tuned for writing TypeScript, and a `reviewer` worker focused on code quality — each with a prompt and model best suited to its task.

### Cost control

Route expensive model capacity where it matters. The primary agent (handling conversation and coordination) can use a mid-tier model while spawning a premium model only for the sub-tasks that require it. The `maxTokensPerRun` budget on each worker agent enforces a hard ceiling on token spend per task.

### Isolation

Sub-agents run in their own Docker containers (or container pool slots). A runaway tool call, an infinite loop, or a crashed container in a sub-agent does not affect the primary agent's container or the user's session.

### Separation of concerns

The primary agent focuses on understanding the user's intent and coordinating results. Sub-agents focus on execution. This mirrors how human teams work: a lead delegates, specialists execute, the lead synthesises.

### Context window management

Each sub-agent starts with a fresh context. Complex multi-step tasks that would otherwise overflow a single context window are split into independent sub-tasks, each well within limits.

---

## The Agents Page

Navigate to **Agents** in the left sidebar (path: `/agents/user-agents`).

![Agents overview page — Public Agents table, My Sub-Agents section, Recent Agent Runs](./assets/agents-overview.png)

The page is divided into three sections:

| Section               | What it shows                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public Agents**     | All official agent definitions available to users. Includes both primary agents and public worker agents. Admins can create, edit, and manage these. |
| **My Sub-Agents**     | Private sub-agents created by the current user. Visible and managed only by that user.                                                               |
| **Recent Agent Runs** | A live log of the current user's agent activity — agent name, run type, input preview, status, duration, and timestamp.                              |

The **Public Agents** table columns:

| Column      | Meaning                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| **Agent**   | Agent name and internal identifier                                                                                  |
| **Model**   | Provider / model name (e.g., `anthropic / claude-sonnet-4-6`, `openai / gpt-4o`, `gemini / gemini-3-flash-preview`) |
| **Role**    | `primary` or `worker` badge                                                                                         |
| **Type**    | `Public` (visible to all users)                                                                                     |
| **Enabled** | Toggle switch; primary agents show "Always on"                                                                      |

---

## Creating a Public (Primary) Agent

**Who can do this:** Admin role only.

Public agents are available to all users and serve as the shared pool of official agent definitions.

1. Go to **Agents** in the sidebar.
2. Click **+ Create Agent** in the top-right corner.

   ![Create Public Agent dialog — all fields](./assets/agents-create-public.png)

3. Fill in the fields:

   | Field                  | Required | Notes                                                                                                                   |
   | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
   | **Name**               | Yes      | 1–255 characters. Used to reference the agent by name in spawn calls.                                                   |
   | **Description**        | No       | Up to 2000 characters. Shown in the UI and injected into the primary agent's context so it knows what each worker does. |
   | **System Prompt**      | Yes      | 1–50 000 characters. Defines the agent's persona, instructions, and capabilities.                                       |
   | **Provider**           | Yes      | Select from configured providers (e.g., `anthropic`, `openai`, `gemini`, `zai-coding`, `kimi-code`).                    |
   | **Model**              | Yes      | Model identifier (e.g., `claude-sonnet-4-6`, `gpt-4o`, `gemini-3-flash-preview`). Must match the selected provider.     |
   | **API Base URL**       | No       | Override the provider's default endpoint. Leave blank for the provider's built-in default.                              |
   | **Max Tokens per Run** | No       | Hard cap on tokens consumed per single run. Default: 100 000.                                                           |

4. Click **Create**. The agent appears in the **Public Agents** table.

> **Role is not selectable in the UI for public agents** — the role is determined by whether you use "Create Agent" (`primary`) or "Create Sub-Agent" (`worker`). To create a public worker agent, use the API directly with `role: 'worker'`.

---

## Creating a Sub-Agent

Sub-agents can be created by any authenticated user for their own use (private), or by an admin as a public worker (via the API).

### Via the UI (private sub-agent)

1. Go to **Agents** in the sidebar.
2. In the **My Sub-Agents** section, click **+ Create Sub-Agent**.

   ![Create Sub-Agent dialog](./assets/agents-create-subagent.png)

3. The form is identical to the public agent form but the **role is fixed to `worker`** — the sub-agent is private to the creating user.
4. Fill in **Name**, **Description**, **System Prompt**, **Provider**, **Model**, **API Base URL** (if needed), and **Max Tokens per Run**.
5. Click **Create**.

The new sub-agent appears in the **My Sub-Agents** section and becomes immediately available for the user's primary agent to spawn by name.

### Sub-agent system prompt guidance

The system prompt is the most important field for a sub-agent. Because sub-agents have no conversation history, the prompt must be entirely self-contained:

- State the agent's role explicitly: _"You are a specialised code reviewer..."_
- List the tools the agent is expected to use (exec, write, web_search, etc.)
- Define the expected **output format** — sub-agent results are returned as plain text to the primary agent, so structure matters (JSON, markdown, numbered lists, etc.)
- Keep the scope narrow — a focused worker is more reliable than a general-purpose one

**Example — researcher sub-agent system prompt:**

```
You are a research specialist. Given a topic or question, you will:
1. Use web_search to find relevant, authoritative sources
2. Read the most relevant pages with web_fetch
3. Synthesise the findings into a concise report (max 500 words)
4. Return the report in markdown format with citations

Be factual. Do not speculate. If information is unavailable, say so.
```

---

## Editing an Agent

**Who can do this:** Admin (for public agents); any user (for their own sub-agents).

> **Restriction:** Official (system-seeded) agents can only be edited by admins.

1. Go to **Agents** in the sidebar.
2. Find the agent in **Public Agents** or **My Sub-Agents**.
3. Click the **⋯** (ellipsis) button on the right of the row.

   ![Agent row action menu — Edit and View Runs](./assets/agents-action-menu.png)

4. Select **Edit**.
5. The **Edit Agent** dialog opens pre-filled with current values.

   ![Edit Agent dialog — all fields visible for default-worker](./assets/agents-edit-dialog.png)

   ![Edit Agent dialog — bottom of form showing Save button](./assets/agents-edit-dialog-bottom.png)

### Editable fields

| Field                  | Notes                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Name**               | Can be changed. If a primary agent references this worker by name in a spawn call, update the spawn call too. |
| **Description**        | Updating the description updates what the primary agent's context sees about this worker.                     |
| **System Prompt**      | The core behaviour definition — changes take effect on the next run.                                          |
| **Provider**           | Change the AI provider. The model field must be compatible with the new provider.                             |
| **Model**              | Change the model. Takes effect on the next run immediately.                                                   |
| **API Base URL**       | Set, change, or clear the endpoint override.                                                                  |
| **Max Tokens per Run** | Raise or lower the hard token cap for this agent.                                                             |

> **Role** is read-only after creation — shown as `Worker (Sub-Agent)` or `Primary`. To change an agent's role, delete it and create a new one with the desired role.

6. Click **Save**. Changes take effect on the next agent run — in-flight runs are not affected.

---

## Enabling and Disabling an Agent

Use the **Enabled** toggle in the Public Agents table to activate or deactivate a worker agent without deleting it.

- **Primary agents** always show "Always on" — they cannot be disabled via the toggle.
- **Worker agents** can be toggled off. A disabled worker is skipped by the primary agent's spawn resolution; if the primary agent tries to spawn a disabled worker by name, the spawn will fail.

---

## Deleting an Agent

1. Click **⋯** on the agent row → select **Edit** → scroll to the bottom and click **Delete** (where available), or use the API `DELETE /api/v1/agents/:id`.

> **Warning:** Deleting a worker agent does not update primary agent system prompts that reference it by name. Update those prompts before deleting to avoid spawn failures.

---

## How the Primary Agent Spawns Sub-Agents

When the primary agent's LLM decides to delegate a task, it calls the **spawn tool** with a prompt and optionally the name of a specific worker:

```
# Named spawn — delegates to the "researcher" worker agent
spawn(agent_name="researcher", prompt="Find the top 5 open-source vector databases and compare their performance benchmarks")

# Anonymous spawn — uses the default-worker agent
spawn(prompt="Summarise the file at /workspace/report.txt in 3 bullet points")
```

**Resolution order for named spawn:**

1. Look up an active `AgentDefinition` with `name = agent_name` and `role = 'worker'`
2. If found and enabled → spawn it
3. If not found → error returned to primary agent

**Anonymous spawn fallback:**

1. Look up an agent named `default-worker`
2. If not found → auto-create a minimal `default-worker` definition from environment defaults

Each spawned sub-agent run:

- Creates a new `AgentRun` record linked to the primary agent run via `parentAgentRunId`
- Runs in a separate container
- Returns its output to the primary agent asynchronously via Redis

The primary agent is re-invoked with the sub-agent's result as a `tool_result` message, then continues its reasoning loop.

---

## Concurrency & Limits

| Limit                         | Default | Notes                                      |
| ----------------------------- | ------- | ------------------------------------------ |
| Max concurrent sub-agents     | 10      | Across all users system-wide               |
| Max queued sub-agents         | 100     | Requests beyond this are rejected          |
| Max re-invocations of primary | 10      | Per session; prevents infinite spawn loops |
| Max tokens per run            | 100 000 | Configurable per agent (default)           |

---

## API Reference

All agent endpoints are under `/api/v1/agents`.

### Public agent endpoints

| Method   | Path                      | Auth                      | Purpose                                          |
| -------- | ------------------------- | ------------------------- | ------------------------------------------------ |
| `GET`    | `/api/v1/agents`          | Public                    | List agents. Filter with `?role=primary\|worker` |
| `GET`    | `/api/v1/agents/:id`      | Public                    | Get single agent definition                      |
| `POST`   | `/api/v1/agents`          | Authed                    | Create a new public agent                        |
| `PATCH`  | `/api/v1/agents/:id`      | Authed (creator or admin) | Update agent fields                              |
| `DELETE` | `/api/v1/agents/:id`      | Authed (creator or admin) | Delete agent                                     |
| `GET`    | `/api/v1/agents/:id/runs` | Public                    | List runs for an agent                           |

### Sub-agent endpoints

| Method | Path                        | Auth   | Purpose                                         |
| ------ | --------------------------- | ------ | ----------------------------------------------- |
| `POST` | `/api/v1/agents/sub-agents` | Authed | Create a private sub-agent for the current user |

### User-agent binding endpoints (admin)

| Method   | Path                             | Auth   | Purpose                                  |
| -------- | -------------------------------- | ------ | ---------------------------------------- |
| `GET`    | `/api/v1/agents/user-agents`     | Authed | Get current user's primary agent binding |
| `POST`   | `/api/v1/agents/user-agents`     | Admin  | Assign an agent to a user                |
| `PATCH`  | `/api/v1/agents/user-agents/:id` | Admin  | Change a user's agent binding            |
| `DELETE` | `/api/v1/agents/user-agents/:id` | Admin  | Remove a user's agent binding            |

### Example: create a primary agent via API

```bash
curl -X POST http://localhost:3001/api/v1/agents \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Senior Assistant",
    "description": "A senior AI assistant for complex project management tasks",
    "systemPrompt": "You are a senior AI assistant...",
    "role": "primary",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "maxTokensPerRun": 150000
  }'
```

### Example: create a worker sub-agent via API

```bash
curl -X POST http://localhost:3001/api/v1/agents/sub-agents \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<user-cuid>",
    "name": "data-analyst",
    "description": "Analyses CSV data and produces structured reports",
    "systemPrompt": "You are a data analyst specialist...",
    "provider": "openai",
    "model": "gpt-4o",
    "maxTokensPerRun": 50000
  }'
```

---

## Field Reference Summary

| Field             | Type     | Constraints                               | Default                    |
| ----------------- | -------- | ----------------------------------------- | -------------------------- |
| `name`            | string   | 1–255 chars, required                     | —                          |
| `description`     | string   | 0–2000 chars, optional                    | —                          |
| `systemPrompt`    | string   | 1–50 000 chars, required                  | `""`                       |
| `role`            | enum     | `primary` or `worker`                     | `primary`                  |
| `provider`        | string   | Must match a configured ProviderConfig ID | `anthropic`                |
| `model`           | string   | Must be compatible with the provider      | `claude-sonnet-4-20250514` |
| `apiBaseUrl`      | URL      | Valid URL or null                         | `null`                     |
| `skillIds`        | string[] | Array of Skill CUIDs                      | `[]`                       |
| `maxTokensPerRun` | integer  | ≥ 1                                       | `100000`                   |
| `isActive`        | boolean  | —                                         | `true`                     |

---

## Troubleshooting

| Symptom                               | Likely cause                                                                                           | Fix                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Primary agent does not spawn workers  | Spawn tool only registered for primary agents with a session — ensure the agent has `role = 'primary'` | Verify agent role in the Public Agents table                       |
| Spawn fails: "agent not found"        | Worker name in spawn call doesn't match any active `AgentDefinition`                                   | Check the agent name exactly (case-sensitive) in the Agents page   |
| Spawn fails: "agent disabled"         | The target worker has `isEnabled = false`                                                              | Enable the worker via the toggle in Public Agents table            |
| Sub-agent produces no output          | System prompt too vague or token budget exhausted                                                      | Refine the system prompt; increase `maxTokensPerRun`               |
| Sub-agent results stale/not delivered | Redis pub/sub issue or max re-invocations reached                                                      | Check Redis health; check `MAX_REINVOCATIONS` setting (default 10) |
| Edit greyed out / error on save       | Trying to edit an official agent as non-admin                                                          | Use an admin account, or create a new private sub-agent            |
| Agent run stuck in "running"          | Container or network issue                                                                             | Use **Stop All** button; check container logs via Docker           |
