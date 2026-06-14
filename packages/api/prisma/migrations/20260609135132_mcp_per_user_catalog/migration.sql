-- DropForeignKey
ALTER TABLE "McpTool" DROP CONSTRAINT "McpTool_mcpServerId_fkey";

-- DropIndex
DROP INDEX "McpTool_mcpServerId_name_key";

-- AlterTable
ALTER TABLE "McpConnection" ADD COLUMN     "lastDiscoveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "McpServer" DROP COLUMN "discoveryCredentialEnc",
DROP COLUMN "lastDiscoveredAt",
DROP COLUMN "lastError",
DROP COLUMN "status";

-- AlterTable
ALTER TABLE "McpTool" DROP COLUMN "mcpServerId",
ADD COLUMN     "mcpConnectionId" TEXT NOT NULL;

-- DropEnum
DROP TYPE "McpServerStatus";

-- CreateIndex
CREATE UNIQUE INDEX "McpTool_mcpConnectionId_name_key" ON "McpTool"("mcpConnectionId", "name");

-- AddForeignKey
ALTER TABLE "McpTool" ADD CONSTRAINT "McpTool_mcpConnectionId_fkey" FOREIGN KEY ("mcpConnectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
