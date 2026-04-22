-- AlterTable
ALTER TABLE "AgentRun" ALTER COLUMN "sessionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TaskRunMessage" (
    "id" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCallId" TEXT,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRunMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskRunMessage_taskRunId_ordering_idx" ON "TaskRunMessage"("taskRunId", "ordering");

-- AddForeignKey
ALTER TABLE "TaskRunMessage" ADD CONSTRAINT "TaskRunMessage_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
