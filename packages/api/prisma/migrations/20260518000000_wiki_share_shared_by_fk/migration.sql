-- WikiShare.sharedBy FK to User
--
-- Previously a free TEXT column; this adds a true foreign-key relation with
-- ON DELETE SET NULL so audit references survive user deletion. Switching to
-- nullable is the only safe option: existing rows already point at real users
-- (those rows stay populated), and future user-deletes leave the share row in
-- place but un-attributed rather than cascade-removing it.

ALTER TABLE "WikiShare" ALTER COLUMN "sharedBy" DROP NOT NULL;

ALTER TABLE "WikiShare"
  ADD CONSTRAINT "WikiShare_sharedBy_fkey"
  FOREIGN KEY ("sharedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WikiShare_sharedBy_idx" ON "WikiShare" ("sharedBy");
