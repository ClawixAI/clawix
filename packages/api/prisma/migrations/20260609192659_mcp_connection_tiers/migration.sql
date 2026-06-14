/*
  Warnings:

  - You are about to drop the `McpToolSuggestion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "McpToolSuggestion" DROP CONSTRAINT "McpToolSuggestion_agentDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "McpToolSuggestion" DROP CONSTRAINT "McpToolSuggestion_mcpServerId_fkey";

-- AlterTable
ALTER TABLE "McpConnection" ADD COLUMN     "tiers" JSONB;

-- DropTable
DROP TABLE "McpToolSuggestion";
