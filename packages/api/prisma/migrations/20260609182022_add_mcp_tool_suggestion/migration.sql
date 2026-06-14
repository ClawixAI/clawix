-- CreateTable
CREATE TABLE "McpToolSuggestion" (
    "id" TEXT NOT NULL,
    "agentDefinitionId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpToolSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpToolSuggestion_agentDefinitionId_mcpServerId_key" ON "McpToolSuggestion"("agentDefinitionId", "mcpServerId");

-- AddForeignKey
ALTER TABLE "McpToolSuggestion" ADD CONSTRAINT "McpToolSuggestion_agentDefinitionId_fkey" FOREIGN KEY ("agentDefinitionId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolSuggestion" ADD CONSTRAINT "McpToolSuggestion_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
