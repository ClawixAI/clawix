-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN     "oauthAutoDiscover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oauthDiscoveredAt" TIMESTAMP(3),
ADD COLUMN     "oauthResource" TEXT;
