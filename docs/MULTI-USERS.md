# Clawix — Multi-User Model

> How Clawix supports multiple users inside a single self-hosted organization, and how primary agents and spawned sub-agents fit into that model.
> Sections describing code that does not yet exist are marked **[pending]**.

---

## 1. Three orthogonal axes

Every user is governed along **three independent axes**. Keeping them orthogonal is deliberate — changing one does not implicitly change the others.

```mermaid
flowchart LR
    U((User)) --> PL[Policy<br/>governance — quotas]
    U --> GR[Group<br/>collaboration — memory sharing]
    U --> RO[UserRole<br/>authorization — what they can do]
```

| Axis         | Model                   | Decides                           | Examples                                                                                |
| ------------ | ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| **Policy**   | `Policy`                | Quotas, limits, allowed providers | `maxTokenBudget`, `maxAgents`, `cronEnabled`, `minCronIntervalSecs`, `allowedProviders` |
| **Group**    | `Group` + `GroupMember` | Who can see shared memory         | "engineering", "sales-asia"                                                             |
| **UserRole** | `User.role` enum        | What actions are permitted        | `admin`, `developer`, `viewer`                                                          |

A user has exactly **one Policy**, **zero-or-more Groups**, and **exactly one Role**. Changing a role never changes quotas; changing a policy never changes group visibility.

---

## 2. User lifecycle

### 2.1 Bootstrap (first admin)

`packages/api/src/bootstrap.ts` runs on API startup and is fully **idempotent** — it never deletes or overwrites existing rows.

```mermaid
sequenceDiagram
    participant Boot as bootstrap.ts
    participant DB as Postgres
    participant SL as SkillLoader

    Boot->>DB: upsert "Unrestricted" Policy
    Boot->>DB: SELECT admin by INITIAL_ADMIN_EMAIL
    alt admin missing
        Boot->>Boot: bcrypt(INITIAL_ADMIN_PASSWORD)
        Boot->>DB: INSERT User (role=admin, policy=Unrestricted)
        Boot->>SL: ensureUserSkillDir(userId)
        Boot->>DB: upsert default primary AgentDefinition
        Boot->>DB: upsert UserAgent binding
        Boot->>DB: upsert "Web Dashboard" Channel
    else admin exists
        Boot-->>Boot: skip (idempotent)
    end
```

Env vars: `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME` (default `Administrator`).

---

## 3. Per-user isolation

Isolation is enforced at four layers:

```mermaid
flowchart TB
    subgraph PerUser["Per-user resources"]
        WS["./data/users/{userId}/workspace/"]
        SK["/skills/custom/{userId}/"]
        MEM[(MemoryItems where ownerId = userId)]
        SES[(Sessions where userId = userId)]
    end
    subgraph Shared["Org-shared"]
        BI[/skills/builtin — read-only/]
        AG[AgentDefinitions<br/>isOfficial = true]
    end
    U((User)) --> PerUser
    U --> Shared
```

### 3.1 Workspace

- `WorkspaceSeederService` plants `SOUL.md`, `USER.md`, `MEMORY.md` the first time a user touches an agent, using templates from `infra/templates/`.

### 3.2 Skills

- `/skills/builtin/` — mounted **read-only** into every container (org-level system skills: `skill-creator`, `projector-creator`).
- `/skills/custom/<userId>/` — mounted read-write into that user's containers only. A user cannot see another user's custom skills because `ContextBuilder` filters to the current user's subtree.
- Quota: `Policy.maxSkills` caps how many custom skills a user can create.

### 3.3 Memory

- `MemoryItem.ownerId` = the writing user.
- `MemoryItemRepository.findVisibleToUser()` returns the union of:
  - items owned by the user,
  - items shared into groups the user belongs to (`MemoryShare.targetType = GROUP`, `isRevoked = false`),
  - items shared org-wide (`MemoryShare.targetType = ORG`, `isRevoked = false`).
- See §7 for the sharing flow.

### 3.4 Sessions

- Composite resolution key: `(userId, agentDefinitionId, channelId)`. One active session per user × agent × channel.
- Sessions carry `AgentRun` rows (each reasoning-loop invocation) and `SessionMessage` rows (persisted turns).
- Cascade-deletes with the user.

### 3.5 Channel ↔ user mapping

```mermaid
flowchart LR
    TG[Telegram update] --> MR
    WS[WebSocket frame] --> MR
    MR[MessageRouter.lookupUser] -->|channel=telegram| BY1[User.findByTelegramId]
    MR -->|channel=web| BY2[User.findById<br/>from JWT]
    BY1 --> CK{isActive?}
    BY2 --> CK
    CK -- no --> REJ[401 Not authorized]
    CK -- yes --> OK[Route to agent]
```

- **Web** — the authenticated JWT carries `userId`; the WebSocket gateway verifies the JWT on connect.
- **Telegram** — each Clawix user can claim one `telegramId`. Messages from an un-claimed Telegram id are rejected.
- **WhatsApp** — implemented via `@whiskeysockets/baileys` (Business API).
- **Slack** — **[pending]** (adapter not implemented).

---

## 4. Primary agent vs sub-agent

Clawix distinguishes **primary** agents (the one a user chats with) from **worker** agents (sub-agents that only ever run when spawned).

```mermaid
flowchart LR
    U[User message] --> P[Primary agent<br/>role=primary]
    P -->|spawn tool| W1[Worker agent<br/>role=worker]
    P -->|spawn tool| W2[Worker agent<br/>role=worker]
    W1 -.X.-> W3[no spawning<br/>sub-agents cannot spawn]
    P --> OUT[Reply to user]
```

### 4.1 Properties

| Property                   | Primary (`role = primary`)                        | Worker (`role = worker`)                       |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Entry point                | User message from any channel                     | `spawn` tool call by a primary                 |
| Session                    | Persistent — resumed per `(user, agent, channel)` | Fresh, isolated, thrown away                   |
| Context builder loads      | History + SOUL.md + USER.md + MEMORY.md + skills  | Focused prompt only (no history, no bootstrap) |
| Container                  | Pulled from `ContainerPoolService` warm pool      | Ephemeral — `start → exec → stop`              |
| `spawn` tool available     | ✅                                                | ❌ (recursion prevented)                       |
| Counts against concurrency | ✅                                                | ✅ (same per-user running cap)                 |

`AgentDefinition.role` is a Prisma enum (`primary | worker`). Workers cannot be chatted with from a channel; primaries cannot be passed to `spawn`.

### 4.2 The `spawn` tool

```mermaid
sequenceDiagram
    participant P as Primary<br/>ReasoningLoop
    participant Spawn as spawn tool
    participant Repo as AgentDefRepo
    participant AR as AgentRunRepo
    participant TE as TaskExecutor
    participant W as Worker container

    P->>Spawn: spawn(agent_name?, prompt)
    alt agent_name provided
        Spawn->>Repo: findByName(agent_name)
        alt role != worker
            Spawn-->>P: ERROR "not a worker"
        end
    else anonymous
        Spawn->>Repo: findOrCreateDefaultWorker(<br/>SUBAGENT_PROVIDER, SUBAGENT_MODEL)
    end
    Spawn->>AR: INSERT AgentRun<br/>(status=pending,<br/>parentAgentRunId=caller)
    Spawn->>TE: submit(runId, userId, sessionId, prompt)
    Spawn-->>P: "Spawned task <id>" (immediate)
    TE->>W: start container + execute loop
    W-->>AR: update status=completed + output
```

Notes:

- Returns **immediately** with a task id — the primary does not block on the worker.
- The parent `AgentRunId` is recorded so the result can be correlated back.
- Anonymous spawn defaults to `SUBAGENT_PROVIDER` / `SUBAGENT_MODEL` env vars. The `default-worker` definition is created once on first use.
- Streaming sub-agent output back into the parent's context (vs polling task status) — **[pending]** in some code paths; today the simplest flow is the parent inspecting the resulting `AgentRun` row.

### 4.3 Agent ownership (`UserAgent`)

Each `(userId, agentDefinitionId)` is bound once in `UserAgent`. That row carries the per-user workspace path and the `lastSessionId` for quick resume.

| Field                         | Purpose                                    |
| ----------------------------- | ------------------------------------------ |
| `userId`, `agentDefinitionId` | Composite unique key.                      |
| `workspacePath`               | Relative path under `WORKSPACE_BASE_PATH`. |
| `lastSessionId`               | Shortcut for "continue last conversation". |

`AgentDefinition.isOfficial`:

- `true` — created by the system/admin; visible to everyone.
- `false` — user-authored (`createdById` set); scoped to that user in listings.

A single fix commit (`c9c2fbb — set isOfficial=false for user-created agents`) records that this distinction is live in code.

---

## 5. Groups and memory sharing

```mermaid
sequenceDiagram
    participant A as User A
    participant B as User B (same group G)
    participant Tool as save_memory / share_memory
    participant Repo as MemoryItemRepository

    A->>Tool: save_memory("...")
    Tool->>Repo: INSERT MemoryItem(ownerId=A)
    A->>Tool: share_memory(itemId, targetType=GROUP, groupId=G)
    Tool->>Repo: INSERT MemoryShare(...)
    Note over Repo: audit log + Notification("MEMORY_SHARED") to B

    B->>Tool: search_memory("keyword")
    Tool->>Repo: findVisibleToUser(B.id)
    Repo-->>Tool: items owned by B<br/>⊕ shared via G<br/>⊕ shared org-wide
    Tool-->>B: match list
```

- `GroupMember.role` is `OWNER` or `MEMBER`. Owners can invite / remove members.
- Sharing is **reversible**: `MemoryShare.isRevoked = true` hides the item without deleting history (soft-delete for audit).
- Notifications (`Notification` model) fire on `MEMORY_SHARED`, `MEMORY_REVOKED`, `GROUP_INVITE` — delivery to channels is **[pending]** for some transports.

Agents are **not** shared through groups — each user has an explicit `UserAgent` binding. Group membership only affects memory visibility today.

---

## 6. Summary — a message from user Alice

```mermaid
sequenceDiagram
    participant Alice as Alice (Telegram)
    participant CH as Telegram Adapter
    participant MR as MessageRouter
    participant AR as AgentRunner (primary)
    participant Pool as ContainerPool
    participant W as Worker sub-agent
    participant DB as Postgres

    Alice->>CH: "plan my sprint"
    CH->>MR: InboundMessage(senderId=telegramId)
    MR->>DB: User.findByTelegramId → Alice, isActive=true
    MR->>DB: hasRunningAgentForUser(Alice.id) → no
    MR->>DB: Session.getOrCreate(Alice, primaryAgent, telegram-channel)
    MR->>AR: run(session, text)
    AR->>Pool: acquire(primaryAgent)
    Pool-->>AR: containerId (warm, Alice-workspace mounted)
    AR->>AR: reasoning loop
    AR->>W: spawn("web-researcher", "look up ...")
    Note over W: fresh ephemeral container<br/>under Alice's workspace<br/>no spawn tool available
    W-->>AR: result
    AR->>DB: save messages + token usage
    AR-->>MR: RunResult
    MR->>CH: sendMessage(telegram)
    CH->>Alice: reply
```

Every step is tied back to Alice via the authenticated `User.id`: workspace path, memory visibility, per-user concurrency, policy quota, and audit log entries. When a sub-agent is spawned during this request it still runs **as Alice** — it uses Alice's workspace, counts against Alice's caps, and contributes to Alice's token budget.
