# Skills

## What is a Skill?

A **Skill** is a modular, self-contained capability package that extends an agent's knowledge and behavior at runtime. Each skill is a directory on the filesystem containing a required `SKILL.md` file and optional bundled resources (scripts, references, assets). Skills are not code injected into the engine — they are structured knowledge that agents read on demand.

Think of a skill as an "onboarding guide" for a specialized task or domain. When an agent encounters a task that matches a skill's purpose, it reads the skill's instructions and follows them as part of its reasoning process.

Skills are **filesystem-based** — no database is involved. The filesystem is the sole source of truth.

---

## The Skills Page

Navigate to **Skills** in the left sidebar (path: `/skills`) to browse all available skills for your account.

![Skills page — Built-in Skills and Your Skills sections](./assets/skills-page.png)

The page is split into two sections:

| Section             | What it shows                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Built-in Skills** | Platform-shipped skills (`skills/builtin/`). Read-only. Available to every user.                  |
| **Your Skills**     | Custom skills you (or your agent) have created (`<workspace>/skills/`). Writable. Private to you. |

Each skill card displays the skill **name**, **description** excerpt, and the **file path** to its `SKILL.md`. The page description reminds you that the `/create-skill` shorthand in a conversation triggers the skill-creator workflow.

---

## Why Use Skills?

| Problem without skills                                        | How skills solve it                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Agents must re-derive domain knowledge from scratch every run | Skills inject reusable procedures once, keeping tokens low                        |
| Repeated tasks produce inconsistent outputs                   | Low-freedom skills lock in exact scripts and sequences                            |
| Agent system prompts grow large and hard to manage            | Progressive loading keeps only skill summaries in context until needed            |
| Organization-specific logic lives only in user messages       | Skills encode business rules, schemas, and workflows that persist across sessions |
| Agents cannot self-improve their tooling                      | Agents create and update custom skills at runtime using their file tools          |
| Capability gaps require code changes and redeployments        | Skills can be added or updated without touching the engine                        |

### Key benefits at a glance

- **Context efficiency** — Only one-line summaries load on startup; full content loads only when the agent chooses to use the skill.
- **Reusability** — A skill written once is available to all sessions of the owning user without duplication.
- **Agent self-improvement** — Agents can author new skills at runtime, permanently encoding successful strategies.
- **Predictability** — Scripts in `scripts/` enforce deterministic, repeatable execution for fragile operations.
- **Isolation** — Each user's custom skills are completely isolated; no cross-user visibility exists.
- **Zero coupling** — Skills require no engine changes. Adding a skill never risks breaking existing behavior.

---

## Filesystem Layout

```
skills/
└── builtin/                   # Shipped with Clawix — git-tracked, read-only
    ├── skill-creator/
    │   ├── SKILL.md
    │   └── scripts/
    │       ├── init_skill.py
    │       ├── quick_validate.py
    │       └── package_skill.py
    └── projector-creator/
        ├── SKILL.md
        └── references/
            └── starter-template.html

<workspace>/skills/             # Inside each user's workspace — gitignored, per-user read-write
└── my-workflow/
    └── SKILL.md
```

### Two tiers

| Tier         | Path                  | Access                  | Purpose                                         |
| ------------ | --------------------- | ----------------------- | ----------------------------------------------- |
| **Built-in** | `skills/builtin/`     | Read-only               | Platform-shipped skills, updated via `git pull` |
| **Custom**   | `<workspace>/skills/` | Read-write (owner only) | User- and agent-created skills                  |

**Override rule:** If a custom skill directory shares the same name as a built-in skill directory, the custom skill takes precedence for that user. The directory name is the override key.

---

## Skill Structure

```
skill-name/
├── SKILL.md              ← Required
├── scripts/              ← Optional — executable code (Python, Bash, etc.)
├── references/           ← Optional — documentation loaded into context as needed
└── assets/               ← Optional — templates, images, fonts used in output
```

### SKILL.md format

```markdown
---
name: data-parser
description: Parse CSV and JSON files into structured summaries. Use when the user provides tabular data files that need to be cleaned or summarized.
version: 1.0.0
author: alice
tags: [data, parsing]
---

# Data Parser

## Overview

[Instructions for the agent on how to use this skill]

## Scripts

- `scripts/parse.py` — Run to parse a file: `python3 scripts/parse.py <input>`

## References

- `references/schema.md` — Read this for the expected output schema
```

### Frontmatter fields

| Field         | Required | Rules                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------- |
| `name`        | Yes      | Lowercase alphanumeric + hyphens only (`^[a-z0-9]+(-[a-z0-9]+)*$`), max 64 chars            |
| `description` | Yes      | What the skill does AND when to use it. This is the primary trigger signal. Max 1024 chars. |
| `version`     | No       | Semantic version string (default: `1.0.0`)                                                  |
| `author`      | No       | Creator identifier                                                                          |
| `tags`        | No       | List of categorization tags                                                                 |

> The `description` field is the most important field. It is what the agent reads to decide whether the skill is relevant. Make it precise: include what the skill does and the exact conditions that should trigger it.

### Resource directories

| Directory     | Purpose                                               | Loaded into context?                    |
| ------------- | ----------------------------------------------------- | --------------------------------------- |
| `scripts/`    | Executable code for deterministic, repeatable tasks   | No — executed inside the container      |
| `references/` | Documentation the agent reads while working           | Yes — on demand, when the agent chooses |
| `assets/`     | Files used in output (templates, images, boilerplate) | No — referenced by path, not content    |

**What not to include:** Do not add `README.md`, `CHANGELOG.md`, or other auxiliary docs. A skill should contain only files that directly support its function.

---

## How the System Works

### Progressive loading

Skills are loaded in two stages to avoid bloating the agent's context window.

**Stage 1 — Summary injected at startup:**

The `SkillLoaderService` scans both tiers and builds an XML summary injected into every agent's system prompt. Each entry is a one-liner:

```xml
<skills>
  <skill>
    <name>data-parser</name>
    <description>Parse CSV and JSON files into structured summaries. Use when...</description>
    <location>/app/skills/custom/{userId}/data-parser/SKILL.md</location>
    <source>custom</source>
  </skill>
</skills>
```

**Stage 2 — On-demand loading:**

When the agent decides a skill is relevant, it uses the `read_file` tool to load the full `SKILL.md` from the path in `<location>`. No special "use_skill" command exists — agents use the same file tools they already have (e.g. `read_file`).

### System prompt ordering

```
1. Agent identity
2. Bootstrap files (SOUL.md, USER.md)
3. Workspace awareness
4. Agent-defined system prompt
5. Skill summary (XML) ← injected here
6. Memory items
```

### Container isolation

When a container starts for a user:

| Host path                 | Container path                 | Mode       |
| ------------------------- | ------------------------------ | ---------- |
| `{SKILLS_BUILTIN_DIR}/`   | `/skills/builtin/`             | Read-only  |
| `skills/custom/{userId}/` | `/app/skills/custom/{userId}/` | Read-write |

The agent sees built-in skills at `/skills/builtin/` (read-only) and its own custom skills at `/app/skills/custom/{userId}/` (read-write). Built-in skills cannot be modified from inside the container.

---

## Creating a Skill

### Option A — Use the built-in skill-creator skill (recommended)

The simplest way to create a skill is to ask the agent in plain language from the **Conversations** page — no file editing required.

![Conversations page — the primary entry point for all agent interactions](./assets/skills-conversations-overview.png)

#### Step 1 — Type your request in the chat input

Describe what you want the skill to do. The agent automatically recognises skill-creation intent and invokes the built-in `skill-creator`.

![Chat input with a skill creation request typed ready to send](./assets/skills-chat-create-typed.png)

Example prompts that trigger skill creation:

```
"Create a skill for parsing Stripe webhook payloads"
"Build a skill that generates TypeScript interfaces from a JSON schema"
"Make a skill for running our standard code review checklist"
```

#### Step 2 — Agent scaffolds and confirms

The agent reads `skill-creator`'s instructions, creates the directory structure under `/app/skills/custom/{userId}/`, writes the `SKILL.md`, adds any scripts, and confirms what it built.

![Agent response confirming the stripe-webhook-parser skill was created with its components](./assets/skills-chat-created.png)

#### Alternative: use the `/skill-creator` slash command

Typing `/` in the chat input opens the command palette. Select `/skill-creator` to start a guided skill-creation session — the agent will prompt you for name, description, scripts, and references step by step.

![Slash command palette showing /skill-creator, /projector-creator, /reset, /compact, /help](./assets/skills-slash-command.png)

The command palette shows all available slash commands with their descriptions pulled directly from each built-in skill's `description` field.

### Option B — Create files directly (advanced)

1. Create the directory under `/app/skills/custom/{userId}/<skill-name>/` inside the container (writable).
2. Write `SKILL.md` with valid frontmatter (see format above).
3. Optionally create `scripts/`, `references/`, `assets/` subdirectories.

The skill is discoverable on the next agent run. Within the same session, the agent can still read the new skill directly by path even before the summary refreshes.

### Validation checklist

- [ ] `name` matches the directory name exactly
- [ ] `name` is lowercase alphanumeric + hyphens, max 64 chars
- [ ] `description` explains what the skill does **and** when to trigger it
- [ ] No symlinks inside the skill directory
- [ ] `SKILL.md` is under 1 MB
- [ ] No extraneous files (README.md, CHANGELOG.md, etc.)

To validate programmatically:

```bash
python3 /skills/builtin/skill-creator/scripts/quick_validate.py /app/skills/custom/{userId}/<skill-name>
```

---

## Using a Skill in Conversation

Skills are invoked **automatically** — the agent reads the skill summary in its context, recognises when a task matches a skill, and uses it without any special command. You can also reference a skill explicitly by name in your message.

### Automatic invocation (implicit)

Simply describe the task. If a skill's `description` matches the situation, the agent loads the full `SKILL.md` and follows its instructions.

```
"Parse this Stripe webhook payload for me: {...}"
```

The agent matches `stripe-webhook-parser` from the skill summary index, reads `/app/skills/custom/{userId}/stripe-webhook-parser/SKILL.md`, and executes the parsing script.

### Explicit invocation

Name the skill directly for unambiguous intent:

```
"Use the stripe-webhook-parser skill to parse this payload: {...}"
```

![Agent invoking the stripe-webhook-parser skill and producing structured output](./assets/skills-chat-use-response.png)

The agent reads the skill file, calls the script inside the container (`parser.py`), and returns the structured result directly in the conversation.

### What the agent does step by step

1. Reads the skill summary XML in its system prompt — finds matching skill by description
2. Calls `read_file("/app/skills/custom/{userId}/stripe-webhook-parser/SKILL.md")` to load full instructions
3. Follows the skill's instructions — may call `shell` to run scripts in the container
4. Returns the output in the format the skill specifies

---

## Writing Effective Skills

### Degree-of-freedom spectrum

Match the specificity of your instructions to the fragility of the task:

| Level              | Form                                 | When to use                                                     |
| ------------------ | ------------------------------------ | --------------------------------------------------------------- |
| **High freedom**   | Plain text instructions              | Multiple valid approaches, context-dependent decisions          |
| **Medium freedom** | Pseudocode or parameterized scripts  | A preferred pattern exists but variation is acceptable          |
| **Low freedom**    | Specific scripts with few parameters | Fragile operations, exact sequences, consistency-critical tasks |

### Keep SKILL.md lean

The context window is shared. Every token in a skill's instructions is a token taken from the conversation. Challenge each paragraph: "Does the agent really need this, or does it already know it?"

- Keep the body under 500 lines.
- Move variant-specific detail into `references/` files; point to them from `SKILL.md`.
- Use examples over explanations — show, don't lecture.
- Put all "when to use" guidance in the `description` frontmatter, not the body.

### Progressive disclosure

Design skills so agents can work at the right depth:

```
Level 1: description field (~100 words)  → agent decides whether skill is relevant
Level 2: SKILL.md body (<500 lines)      → agent reads full instructions when triggered
Level 3: references/ and scripts/        → agent reads specific files as needed
```

---

## Built-in Skills Reference

| Skill               | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `skill-creator`     | Guides agents through creating and packaging new skills       |
| `projector-creator` | Creates polished, sandboxed HTML tools for the Projector page |

Built-in skills live in `skills/builtin/` (git-tracked). They are updated when Clawix updates. A user can override a built-in skill by creating a custom skill with the same directory name.

---

## Configuration

| Env var               | Default                      | Description                                |
| --------------------- | ---------------------------- | ------------------------------------------ |
| `SKILLS_BUILTIN_DIR`  | `<repo-root>/skills/builtin` | Absolute path to built-in skills directory |
| `MAX_SKILLS_PER_USER` | `50`                         | Maximum custom skills per user             |

---

## Security

- **Path traversal prevention** — skill names are validated against `^[a-z0-9]+(-[a-z0-9]+)*$`; no `/`, `\`, or `..` can appear.
- **No symlinks** — symlinked skill directories are rejected during scanning.
- **File size limit** — `SKILL.md` must be under 1 MB.
- **Built-in protection** — `skills/builtin/` is mounted read-only inside containers.
- **User isolation** — only the owning user's workspace (including `/app/skills/custom/{userId}/`) is mounted; no other user's workspace is visible.
- **Host-side execution** — skill content is read as data by the host-side loader. Scripts execute exclusively inside agent containers, never on the host.
