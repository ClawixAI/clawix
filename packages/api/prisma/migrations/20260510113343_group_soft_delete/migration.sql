-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Group_deletedAt_idx" ON "Group"("deletedAt");
