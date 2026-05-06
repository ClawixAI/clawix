# Providers — Guide

## What is a Provider?

A **Provider** in Clawix is a configured connection to an AI language model service (such as Anthropic, OpenAI, or Z.AI Coding). Each provider entry stores the credentials and endpoint settings that agents use when they execute AI tasks. At runtime, the Clawix Core Engine resolves the correct API key and base URL from the active provider record, decrypts the credential, and instantiates the appropriate LLM client—all transparently, without agents needing to handle secrets directly.

Providers are managed exclusively by organization administrators via **Settings → Providers** (path: `/settings/providers`).

![Providers overview — Settings → Providers page showing the provider table](./assets/providers-overview.png)

---

## Why Use Multiple Providers?

Configuring more than one provider gives your organization several concrete advantages:

| Benefit                      | Details                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Redundancy & failover**    | If one provider's API is degraded, agents assigned to a different provider continue working without interruption.                                                                                                   |
| **Cost optimisation**        | Route high-volume, low-complexity tasks to cheaper models (e.g., GPT-4o-mini) and reserve premium models (e.g., Claude Opus) for complex reasoning.                                                                 |
| **Capability coverage**      | Some providers support features others do not. Anthropic supports extended thinking; OpenAI supports the Responses API for certain codex/GPT-5 models. Multi-provider setups let you pick the right tool per agent. |
| **Policy flexibility**       | Policies can whitelist specific providers. With multiple providers configured, different Policy tiers can grant access to different model families.                                                                 |
| **Experimentation**          | Run A/B comparisons between model families without reconfiguring individual agents—just switch the provider reference.                                                                                              |
| **Custom/private endpoints** | Add a `custom` provider pointing to an internally-hosted or fine-tuned model via the Base URL field, keeping commercially-sensitive workloads on-premises.                                                          |

---

## Provider Fields Reference

| Field                       | Required | Description                                                                                                                                     |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider**                | Yes      | Internal identifier. Lowercase alphanumeric, hyphens allowed. Max 64 characters. Must be unique. Examples: `anthropic`, `openai`, `zai-coding`. |
| **Display Name**            | Yes      | Human-readable label shown in the UI. Max 128 characters.                                                                                       |
| **API Key**                 | Yes      | The secret credential for the provider's API. Encrypted at rest with AES-256-GCM. Shown masked in the UI (e.g., `sk-***...r00A`).               |
| **Base URL (optional)**     | No       | Override the provider's default API endpoint. Required for `custom` providers or private deployments. Must be a valid URL.                      |
| **Set as default provider** | No       | Marks this provider as the organisation-wide default. Only one provider can be the default at a time.                                           |
| **Enabled**                 | —        | Toggle to enable/disable a provider without deleting it. Disabled providers are skipped during agent resolution.                                |

---

## Built-in Provider Types

Clawix ships with first-class support for five provider types. A `custom` type is also available for OpenAI-compatible endpoints.

### Anthropic

- **Provider ID:** `anthropic`
- **Models:** `claude-opus-4-*`, `claude-sonnet-4-*`, `claude-haiku-4-*`
- **Capabilities:** Tool calling, extended thinking (o-style reasoning)
- **Default endpoint:** Anthropic SDK default (no Base URL needed)
- **Environment seed variable:** `ANTHROPIC_API_KEY`

### OpenAI

- **Provider ID:** `openai`
- **Models:** `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o3`, `o3-mini`, `o4-mini`, `codex-*`, `gpt-5.*`
- **Capabilities:** Tool calling. Note: `codex-*` and `gpt-5.*` models use the **Responses API** automatically instead of the Chat Completions API.
- **Default endpoint:** OpenAI SDK default (no Base URL needed)
- **Environment seed variable:** `OPENAI_API_KEY`

### Z.AI Coding

- **Provider ID:** `zai-coding`
- **Models:** `glm-*`
- **Default endpoint:** `https://api.z.ai/api/coding/paas/v4`
- **Environment seed variable:** `ZAI_CODING_API_KEY`

### Google Gemini

- **Provider ID:** `gemini`
- **Models:** `gemini-3-pro-preview`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3-flash-lite-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`
- **Capabilities:** Tool calling
- **Default endpoint:** `https://generativelanguage.googleapis.com/v1beta/`
- **Environment seed variable:** `GEMINI_API_KEY`

### Kimi Coding

- **Provider ID:** `kimi-code`
- **Models:** (various, via Kimi API)
- **Default endpoint:** `https://api.kimi.com/coding`
- **Environment seed variable:** `KIMI_CODE_API_KEY`

### Custom (OpenAI-compatible)

- **Provider ID:** any name matching `^[a-z0-9-]+$` that is not one of the above
- **Base URL:** required — point to your self-hosted or third-party OpenAI-compatible endpoint
- **Capabilities:** depends on the target model; tool calling not guaranteed

### Planned providers

The following providers are on the roadmap but not yet implemented:

| Provider     | Detection                    | Notes                  |
| ------------ | ---------------------------- | ---------------------- |
| Azure OpenAI | config key "azure_openai"    | Enterprise deployments |
| DeepSeek     | model contains "deepseek"    | Cost-effective         |
| OpenRouter   | API key starts with "sk-or-" | Gateway                |

---

## Adding a Provider

**Who can do this:** Admin role only.

**Navigate to:** Settings → Providers → **Add Provider**

### Steps

1. Open **Settings → Providers** from the left sidebar (under the "Governance" section).
2. Click **+ Add Provider** in the top-right corner. A dialog opens.

   ![Add Provider dialog — provider type dropdown](./assets/providers-add-form.png)

3. **Select a provider type** from the dropdown:
   - `Anthropic`
   - `OpenAI`
   - `Z.AI Coding`
   - _(custom: type a new ID directly if needed via the API)_

   ![Add Provider dialog — Anthropic selected](./assets/providers-add-anthropic.png)

4. Enter the **API Key** for that provider. The field is masked — click the eye icon to reveal it while typing.
5. Optionally enter a **Base URL** if you need to override the default endpoint (required for custom/private models).
6. Tick **Set as default provider** if this should be the organisation-wide default. Doing so will automatically clear the default flag from any previously-default provider.
7. Click **Add Provider**. The new entry appears in the providers table.

### Validation rules enforced on creation

- `provider` ID must be 1–64 characters, lowercase alphanumeric and hyphens only (`^[a-z0-9-]+$`).
- `provider` ID must be unique — duplicate IDs are rejected.
- `displayName` must be 1–128 characters.
- `apiKey` must not be empty.
- `apiBaseUrl`, when provided, must be a syntactically valid URL.

---

## Editing a Provider

**Who can do this:** Admin role only.

1. Go to **Settings → Providers**.
2. In the provider row, click the **⋯** (ellipsis) button on the right.

   ![Provider row action menu — Edit and Remove options](./assets/providers-action-menu.png)

3. Select **Edit** from the dropdown menu.
4. The **Edit Provider** dialog opens, pre-filled with current values.

   ![Edit Provider dialog — pre-filled fields for OpenAI](./assets/providers-edit-dialog.png)

### Editable fields

| Field            | Notes                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| **Display Name** | Can be changed freely.                                                            |
| **API Key**      | Leave blank to keep the existing key. Enter a new value to rotate the credential. |
| **Base URL**     | Can be set, changed, or cleared (set to empty to restore the provider's default). |

> **Note:** The `Provider ID` field is read-only after creation and cannot be changed. If you need to change the ID, remove the provider and add a new one.

5. Click **Save**. Changes take effect immediately; the credential cache is invalidated so the next agent call picks up the new key.

---

## Enabling and Disabling a Provider

Use the **Enabled** toggle in the providers table to activate or deactivate a provider without deleting it.

- **Enabled (on):** agents whose `provider` field matches this ID will use it.
- **Disabled (off):** the provider is skipped during resolution. Agents assigned to a disabled provider will fall back to the corresponding environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.), or fail if no fallback exists.

Disabling is useful during key rotation or when a provider's API is temporarily unreliable.

---

## Setting the Default Provider

Only one provider can be the default at a time. The default provider is used when:

- An agent definition does not specify a `provider` field.
- A policy does not restrict provider access.

To change the default:

1. Edit any provider and tick **Set as default provider**, then save. The previous default is automatically unset.
2. Or, when adding a new provider, tick **Set as default provider** before clicking **Add Provider**.

The default provider is indicated by a **★ Default** badge in the table.

---

## Removing a Provider

1. Click **⋯** on the provider row (see the action menu screenshot above) → **Remove**.
2. Confirm the deletion prompt.

> **Warning:** Removing a provider does not update agents that reference it. Those agents will fail to resolve a provider at runtime. Update affected agents to point to another provider before removing.

---

## Provider Resolution Order (Runtime)

When an agent runs, Clawix resolves the provider in this order:

1. **Database ProviderConfig** — if a record exists for the agent's `provider` field and `isEnabled = true`, the stored (decrypted) API key and base URL are used. Results are cached for 60 seconds.
2. **Environment variable fallback** — if no enabled database record exists, the corresponding env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ZAI_CODING_API_KEY`) is used.
3. **Error** — if neither source provides a key, the agent run fails with a provider resolution error.

### Policy enforcement

Before a provider is used, the agent's assigned Policy is checked:

- If `Policy.allowedProviders` is non-empty, the agent's `provider` value must be in that list.
- Violations raise a policy error and the run is aborted.

This lets you restrict certain policy tiers to approved providers (e.g., a "Basic" policy may only permit `openai`, while a "Pro" policy permits both `openai` and `anthropic`).

---

## Environment-Based Seeding

On first startup (when the `ProviderConfig` table is empty), Clawix automatically seeds provider records from environment variables:

| Env Var              | Provider seeded |
| -------------------- | --------------- |
| `ANTHROPIC_API_KEY`  | `anthropic`     |
| `OPENAI_API_KEY`     | `openai`        |
| `ZAI_CODING_API_KEY` | `zai-coding`    |
| `GEMINI_API_KEY`     | `gemini`        |
| `KIMI_CODE_API_KEY`  | `kimi-code`     |

The **first** variable found becomes the default provider. Once records exist in the database, the seed step is skipped on subsequent restarts. All future credential management should be done via the UI or admin API.

---

## API Reference (Admin)

All endpoints require the `Admin` role.

| Method   | Path                         | Purpose                              |
| -------- | ---------------------------- | ------------------------------------ |
| `GET`    | `/admin/providers`           | List all providers (API keys masked) |
| `GET`    | `/admin/providers/:provider` | Get single provider by ID            |
| `POST`   | `/admin/providers`           | Create a new provider                |
| `PATCH`  | `/admin/providers/:provider` | Update provider fields               |
| `DELETE` | `/admin/providers/:provider` | Delete a provider                    |

A public read-only endpoint is also available (no auth required):

| Method | Path         | Purpose                                                                                         |
| ------ | ------------ | ----------------------------------------------------------------------------------------------- |
| `GET`  | `/providers` | List enabled providers with capability metadata (supportsTools, supportsThinking, defaultModel) |

### Example: create a provider via API

```bash
curl -X POST http://localhost:3001/admin/providers \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "anthropic",
    "displayName": "Anthropic",
    "apiKey": "sk-ant-...",
    "isEnabled": true,
    "isDefault": true
  }'
```

### Example: rotate an API key

```bash
curl -X PATCH http://localhost:3001/admin/providers/anthropic \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "sk-ant-new-key-..."
  }'
```

---

## Security Notes

- API keys are **never stored in plaintext**. They are encrypted with AES-256-GCM before being written to the database.
- API keys are **masked in all API responses** (e.g., `sk-***...r00A` showing only the last 4 characters). The full key cannot be retrieved after creation — if lost, rotate it.
- Provider management endpoints are **admin-only**; non-admin roles receive a 403 response.
- The credential cache has a **60-second TTL**. After updating or rotating a key, up to 60 seconds may elapse before all in-flight agent calls use the new credential.

---

## Troubleshooting

| Symptom                                           | Likely cause                                                             | Fix                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Agent fails with "provider not found"             | Provider ID in agent definition doesn't match any enabled ProviderConfig | Check Settings → Providers; ensure the provider exists and is enabled.                     |
| Agent fails with "provider not allowed by policy" | The agent's Policy restricts provider access                             | Update the Policy's `allowedProviders` list or reassign the agent to a permitted provider. |
| 401 errors from the AI API                        | API key is invalid or expired                                            | Edit the provider and rotate the API key.                                                  |
| New key not taking effect                         | Credential cache not yet expired                                         | Wait up to 60 seconds, or restart the API service to flush the cache immediately.          |
| "Cannot use provider — disabled"                  | Provider `isEnabled` is false                                            | Enable the provider via the toggle in the providers table.                                 |
