-- Add TOOL_APPROVAL to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE 'TOOL_APPROVAL';

-- Create ApprovalStatus enum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED');

-- Create ApprovalRequest table
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "sessionId" TEXT,
    "toolName" TEXT NOT NULL,
    "paramsSummary" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "scope" TEXT,
    "resolutionReason" TEXT,
    "memoryStore" TEXT,
    "memoryKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- Create indexes for ApprovalRequest
CREATE INDEX "ApprovalRequest_userId_status_idx" ON "ApprovalRequest"("userId", "status");
CREATE INDEX "ApprovalRequest_agentRunId_idx" ON "ApprovalRequest"("agentRunId");

-- Create UserToolApproval table
CREATE TABLE "UserToolApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserToolApproval_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint for UserToolApproval
CREATE UNIQUE INDEX "UserToolApproval_userId_toolName_resourceKey_key" ON "UserToolApproval"("userId", "toolName", "resourceKey");

-- Create index for UserToolApproval
CREATE INDEX "UserToolApproval_userId_idx" ON "UserToolApproval"("userId");

-- Add annotations column to McpTool
ALTER TABLE "McpTool" ADD COLUMN "annotations" JSONB;

-- Add approvalOverrides column to McpConnection
ALTER TABLE "McpConnection" ADD COLUMN "approvalOverrides" JSONB;
