-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN     "oauthAuthorizeUrl" TEXT,
ADD COLUMN     "oauthClientId" TEXT,
ADD COLUMN     "oauthClientSecretEnc" TEXT,
ADD COLUMN     "oauthScopes" TEXT,
ADD COLUMN     "oauthTokenUrl" TEXT;

-- CreateTable
CREATE TABLE "McpOAuthToken" (
    "mcpConnectionId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3),

    CONSTRAINT "McpOAuthToken_pkey" PRIMARY KEY ("mcpConnectionId")
);

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_mcpConnectionId_fkey" FOREIGN KEY ("mcpConnectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
