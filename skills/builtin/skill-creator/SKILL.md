---
name: skill-creator
description: Create or update skills. Use when designing, structuring, or packaging skills with scripts, references, and assets.
version: 1.0.0
author: clawix
tags: [meta, tooling]
---

# Skill Creator

This skill provides guidance for creating effective skills.

## About Skills

Skills are modular, self-contained packages that extend the agent's capabilities by providing
specialized knowledge, workflows, and tools. Think of them as "onboarding guides" for specific
domains or tasks — they transform the agent from a general-purpose agent into a specialized agent
equipped with procedural knowledge that no model can fully possess.

### What Skills Provide

1. Specialized workflows - Multi-step procedures for specific domains
2. Tool integrations - Instructions for working with specific file formats or APIs
3. Domain expertise - Company-specific knowledge, schemas, business logic
4. Bundled resources - Scripts, references, and assets for complex and repetitive tasks

## Core Principles

### Concise is Key

The context window is a public good. Skills share the context window with everything else the agent needs: system prompt, conversation history, other skills' metadata, and the actual user request.

**Default assumption: the agent is already very smart.** Only add context the agent doesn't already have. Challenge each piece of information: "Does the agent really need this explanation?" and "Does this paragraph justify its token cost?"

Prefer concise examples over verbose explanations.

### Set Appropriate Degrees of Freedom

Match the level of specificity to the task's fragility and variability:

**High freedom (text-based instructions)**: Use when multiple approaches are valid, decisions depend on context, or heuristics guide the approach.

**Medium freedom (pseudocode or scripts with parameters)**: Use when a preferred pattern exists, some variation is acceptable, or configuration affects behavior.

**Low freedom (specific scripts, few parameters)**: Use when operations are fragile and error-prone, consistency is critical, or a specific sequence must be followed.

### Anatomy of a Skill

Every skill consists of a required SKILL.md file and optional bundled resources:

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   ├── description: (required)
│   │   ├── version: (optional)
│   │   ├── author: (optional)
│   │   └── tags: (optional)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code (Python/Bash/etc.)
    ├── references/       - Documentation intended to be loaded into context as needed
    └── assets/           - Files used in output (templates, icons, fonts, etc.)
```

#### SKILL.md (required)

Every SKILL.md consists of:

- **Frontmatter** (YAML): Contains `name` and `description` fields. These are the only fields that the agent reads to determine when the skill gets used, thus it is very important to be clear and comprehensive in describing what the skill is, and when it should be used.
- **Body** (Markdown): Instructions and guidance for using the skill. Only loaded AFTER the skill triggers (if at all).

#### Bundled Resources (optional)

##### Scripts (`scripts/`)

Executable code (Python/Bash/etc.) for tasks that require deterministic reliability or are repeatedly rewritten.

- **When to include**: When the same code is being rewritten repeatedly or deterministic reliability is needed
- **Benefits**: Token efficient, deterministic, may be executed without loading into context

##### References (`references/`)

Documentation and reference material intended to be loaded as needed into context to inform the agent's process and thinking.

- **When to include**: For documentation that the agent should reference while working
- **Best practice**: If files are large (>10k words), include grep search patterns in SKILL.md
- **Avoid duplication**: Information should live in either SKILL.md or references files, not both

##### Assets (`assets/`)

Files not intended to be loaded into context, but rather used within the output the agent produces.

- **When to include**: When the skill needs files that will be used in the final output (templates, images, boilerplate)

#### What to Not Include in a Skill

A skill should only contain essential files that directly support its functionality. Do NOT create extraneous documentation or auxiliary files (README.md, CHANGELOG.md, INSTALLATION_GUIDE.md, etc.).

### Progressive Disclosure Design Principle

Skills use a three-level loading system to manage context efficiently:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - As needed by the agent

Keep SKILL.md body to the essentials and under 500 lines. Split content into separate files when approaching this limit. Reference split-out files from SKILL.md with clear descriptions of when to read them.

**Key principle:** When a skill supports multiple variations, frameworks, or options, keep only the core workflow and selection guidance in SKILL.md. Move variant-specific details into separate reference files.

## Skill Creation Process

1. Understand the skill with concrete examples
2. Plan reusable skill contents (scripts, references, assets)
3. Initialize the skill (run init_skill.py or use write_file directly)
4. Edit the skill (implement resources and write SKILL.md)
5. Validate the skill (run quick_validate.py)
6. Optionally package the skill (run package_skill.py)
7. Iterate based on real usage

### Skill Naming

- Use lowercase letters, digits, and hyphens only
- Max 64 characters
- Prefer short, verb-led phrases that describe the action (e.g., `parse-csv`, `deploy-aws`)
- Name the skill folder exactly after the skill name

### Step 1: Understanding the Skill with Concrete Examples

Skip this step only when the skill's usage patterns are already clearly understood.

To create an effective skill, clearly understand concrete examples of how the skill will be used. Ask the user questions like:

- "What functionality should this skill support?"
- "Can you give some examples of how this skill would be used?"
- "What would a user say that should trigger this skill?"

Avoid asking too many questions in a single message. Start with the most important.

### Step 2: Planning the Reusable Skill Contents

Analyze each concrete example by:

1. Considering how to execute on the example from scratch
2. Identifying what scripts, references, and assets would be helpful when executing these workflows repeatedly

### Step 3: Initializing the Skill

When creating a new skill from scratch, you can either:

**Option A** — Use the init script:

```bash
python3 /skills/builtin/skill-creator/scripts/init_skill.py my-skill-name
python3 /skills/builtin/skill-creator/scripts/init_skill.py my-skill-name --resources scripts,references
```

The script creates the skill under `/skills/custom/` by default.

**Option B** — Use file tools directly:

Create `/skills/custom/<skill-name>/SKILL.md` with write_file, and optionally create `scripts/`, `references/`, `assets/` subdirectories.

**Important:** Custom skills must be created under `/skills/custom/` (writable). `/skills/builtin/` is read-only.

### Step 4: Edit the Skill

Remember that the skill is being created for another instance of the agent to use. Include information that would be beneficial and non-obvious to the agent.

#### Frontmatter

- `name`: The skill name (must match directory name)
- `description`: Primary triggering mechanism. Include both what the skill does and when to use it. All "when to use" information goes here — not in the body.

#### Body

Write instructions for using the skill and its bundled resources.

### Step 5: Validate the Skill

Run the validator to check the skill structure:

```bash
python3 /skills/builtin/skill-creator/scripts/quick_validate.py /skills/custom/<skill-name>
```

### Step 6: Package the Skill (Optional)

Package a skill into a distributable `.skill` file:

```bash
python3 /skills/builtin/skill-creator/scripts/package_skill.py /skills/custom/<skill-name>
```

### Step 7: Iterate

After testing the skill, improve based on real usage:

1. Use the skill on real tasks
2. Notice struggles or inefficiencies
3. Update SKILL.md or bundled resources
4. Test again
