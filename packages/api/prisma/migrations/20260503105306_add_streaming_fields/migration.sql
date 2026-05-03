-- AlterTable
ALTER TABLE "AgentDefinition" ADD COLUMN     "streamingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "toolProgressMode" TEXT;
