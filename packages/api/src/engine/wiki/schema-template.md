# Wiki Schema

This page describes how to organize your wiki. The agent reads it at the
start of every session and follows these conventions.

## Tag conventions

- `domain:<x>` — exactly one per page when using non-daily tags. Groups
  pages in the index (e.g. `domain:hr`, `domain:engineering`).
- `daily:YYYY-MM-DD` — daily notes; exempt from the domain rule. Last 3
  days auto-load into context.
- Other free-form tags — visible as chips, searchable.

Note: user-profile facts (name, timezone, role, preferences) live in
`/workspace/USER.md`, not in wiki pages — keep them out of here so the
two stores don't drift.

## Scope

- **AMBIENT** — pages whose full content auto-loads into every session.
  Limited to a small cap per user. Use for: identity, preferences,
  current project state, "things you should know without asking."
- **ARCHIVED** (default) — pages retrieved on demand via `wiki_index`,
  `wiki_read`, `wiki_search`. Use for: knowledge-base entries, policies,
  daily notes, references.

## Linking

Reference other pages with `[[slug]]` markers inside content. Resolved
links become backlinks the agent can navigate via `wiki_read({
includeBacklinks: true })`.

## Page anatomy

Each page has:

- `title` — human-readable
- `slug` — auto-derived from title, used in `[[slug]]` links
- `summary` — one-liner shown in the index (≤200 chars; required)
- `content` — markdown body (≤10000 chars)

## Personal customizations

Edit this page to add your own conventions — e.g. preferred spelling,
required fields per domain, source-citation rules. The agent reads this
section literally.
