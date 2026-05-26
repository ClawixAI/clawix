-- Drop legacy MemoryItem/MemoryShare tables after Phase 5 backfill.
-- WikiPage/WikiShare have been the source of truth since FEATURE_WIKI_MEMORY=true (T34).
-- The backfill script (T19) copied data; no further data preservation needed.
--
-- ⚠️  DESTRUCTIVE — operators MUST run the backfill (packages/api/src/scripts/migrate-memory-to-wiki.ts)
--     BEFORE deploying this migration in any environment with real data.

DROP TABLE IF EXISTS "MemoryShare";
DROP TABLE IF EXISTS "MemoryItem";

ALTER TABLE "Policy" DROP COLUMN IF EXISTS "maxMemoryItems";
