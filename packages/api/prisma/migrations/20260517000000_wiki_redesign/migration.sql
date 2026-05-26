-- Wiki Memory Redesign — see docs/specs/2026-05-17-wiki-memory-redesign-design.md §6.1
-- Additive: legacy MemoryItem/MemoryShare tables stay until Phase 5.

-- 1. pg_trgm extension (required for trigram GIN indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. New enum
CREATE TYPE "WikiScope" AS ENUM ('AMBIENT', 'ARCHIVED');

-- 3. WikiPage table
CREATE TABLE "WikiPage" (
    "id"        TEXT NOT NULL,
    "ownerId"   TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "slug"      TEXT NOT NULL,
    "summary"   TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "tags"      TEXT[],
    "scope"     "WikiScope" NOT NULL DEFAULT 'ARCHIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WikiPage_ownerId_slug_key"    ON "WikiPage" ("ownerId", "slug");
CREATE INDEX        "WikiPage_ownerId_scope_idx"   ON "WikiPage" ("ownerId", "scope");
CREATE INDEX        "WikiPage_ownerId_updatedAt_idx" ON "WikiPage" ("ownerId", "updatedAt");

-- 4. WikiShare (visibility + sharing for WikiPage)
CREATE TABLE "WikiShare" (
    "id"         TEXT NOT NULL,
    "pageId"     TEXT NOT NULL,
    "sharedBy"   TEXT NOT NULL,
    "targetType" "ShareTarget" NOT NULL,
    "groupId"    TEXT,
    "sharedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"  TIMESTAMP(3),
    "isRevoked"  BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WikiShare_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WikiShare_pageId_isRevoked_idx"  ON "WikiShare" ("pageId",  "isRevoked");
CREATE INDEX "WikiShare_groupId_isRevoked_idx" ON "WikiShare" ("groupId", "isRevoked");

-- 5. WikiLink (cross-references derived from [[slug]] markers in content)
CREATE TABLE "WikiLink" (
    "id"         TEXT NOT NULL,
    "fromPageId" TEXT NOT NULL,
    "toPageId"   TEXT NOT NULL,

    CONSTRAINT "WikiLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WikiLink_fromPageId_toPageId_key" ON "WikiLink" ("fromPageId", "toPageId");
CREATE INDEX        "WikiLink_toPageId_idx"            ON "WikiLink" ("toPageId");

-- Foreign keys
ALTER TABLE "WikiPage"  ADD CONSTRAINT "WikiPage_ownerId_fkey"   FOREIGN KEY ("ownerId")    REFERENCES "User"("id")     ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiLink"  ADD CONSTRAINT "WikiLink_fromPageId_fkey" FOREIGN KEY ("fromPageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiLink"  ADD CONSTRAINT "WikiLink_toPageId_fkey"   FOREIGN KEY ("toPageId")   REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiShare" ADD CONSTRAINT "WikiShare_pageId_fkey"    FOREIGN KEY ("pageId")     REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiShare" ADD CONSTRAINT "WikiShare_groupId_fkey"   FOREIGN KEY ("groupId")    REFERENCES "Group"("id")    ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Per-user migration marker (set by T20 lazy filesystem ingest)
ALTER TABLE "User" ADD COLUMN "wikiMigratedAt" TIMESTAMP(3);

-- 7. New policy fields (legacy `maxMemoryItems` kept until Phase 5)
ALTER TABLE "Policy" ADD COLUMN "maxWikiPages"    INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Policy" ADD COLUMN "maxAmbientPages" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Policy" ADD COLUMN "wikiLintEnabled" BOOLEAN NOT NULL DEFAULT true;

-- 8. Seed per-tier defaults for the new caps (tier name conventions per docs)
UPDATE "Policy" SET "maxAmbientPages" = 5,  "maxWikiPages" = 500    WHERE "name" = 'standard';
UPDATE "Policy" SET "maxAmbientPages" = 15, "maxWikiPages" = 2000   WHERE "name" = 'extended';
UPDATE "Policy" SET "maxAmbientPages" = 30, "maxWikiPages" = 10000  WHERE "name" = 'unrestricted';

-- 9. Extra GIN indexes for full-text and trigram search (Prisma-unmanaged; additive only)
CREATE INDEX "wiki_page_tags"          ON "WikiPage" USING GIN (tags);
CREATE INDEX "wiki_page_content_trgm"  ON "WikiPage" USING GIN (content gin_trgm_ops);
CREATE INDEX "wiki_page_title_trgm"    ON "WikiPage" USING GIN (title   gin_trgm_ops);
CREATE INDEX "wiki_page_tsv"           ON "WikiPage"
    USING GIN (to_tsvector('simple',
        coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'')));
