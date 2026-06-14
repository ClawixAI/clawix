-- CreateEnum
CREATE TYPE "McpTransport" AS ENUM ('http', 'sse');

-- CreateEnum
CREATE TYPE "McpAuthType" AS ENUM ('none', 'header', 'oauth');

-- CreateEnum
CREATE TYPE "McpServerStatus" AS ENUM ('active', 'error');

-- CreateEnum
CREATE TYPE "McpConnectionStatus" AS ENUM ('active', 'disabled', 'error', 'reauth_required');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MCP_SERVER_ATTENTION';

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "allowMcp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "transportType" "McpTransport" NOT NULL DEFAULT 'http',
    "url" TEXT NOT NULL,
    "authType" "McpAuthType" NOT NULL DEFAULT 'none',
    "authHeaderName" TEXT,
    "credentialFormat" TEXT,
    "setupInstructionsMd" TEXT NOT NULL DEFAULT '',
    "discoveryCredentialEnc" TEXT,
    "status" "McpServerStatus" NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "lastDiscoveredAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpTool" (
    "id" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "scanFlagged" BOOLEAN NOT NULL DEFAULT false,
    "scanReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpConnection" (
    "id" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialEnc" TEXT,
    "status" "McpConnectionStatus" NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_slug_key" ON "McpServer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "McpTool_mcpServerId_name_key" ON "McpTool"("mcpServerId", "name");

-- CreateIndex
CREATE INDEX "McpConnection_userId_idx" ON "McpConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "McpConnection_mcpServerId_userId_key" ON "McpConnection"("mcpServerId", "userId");

-- AddForeignKey
ALTER TABLE "McpTool" ADD CONSTRAINT "McpTool_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
