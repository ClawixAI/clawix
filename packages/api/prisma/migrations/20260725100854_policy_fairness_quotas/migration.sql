-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "maxConcurrentPrimaryRuns" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxConcurrentSubAgents" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "maxPendingSubAgents" INTEGER NOT NULL DEFAULT 20;
