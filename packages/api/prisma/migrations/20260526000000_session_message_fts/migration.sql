-- Session Recall — see docs/specs/2026-05-26-session-recall-design.md §2
-- Additive, Prisma-unmanaged: partial GIN indexes over conversational
-- SessionMessage rows (user + assistant) for cross-session full-text search.
-- The `tool`/`system` rows (verbatim tool output, hints) are intentionally
-- excluded. The to_tsvector expression below MUST stay byte-identical to the
-- one in SessionMessageSearchRepository.search().

-- pg_trgm already created by the wiki migration; idempotent / harmless to repeat.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text index (partial: conversational rows only).
CREATE INDEX "session_message_recall_tsv"
  ON "SessionMessage"
  USING GIN (to_tsvector('simple', content))
  WHERE role IN ('user', 'assistant');

-- Trigram index for typo-tolerant fuzzy matching (partial: same predicate).
CREATE INDEX "session_message_recall_trgm"
  ON "SessionMessage"
  USING GIN (content gin_trgm_ops)
  WHERE role IN ('user', 'assistant');
