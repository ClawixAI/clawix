-- Persist the token budget and grace percent on each AgentRun so a recovered
-- orphan sub-agent (after an API crash) can reconstruct a BudgetTracker with
-- the same cap it was spawned under.
ALTER TABLE "AgentRun"
  ADD COLUMN "tokenBudget" INTEGER,
  ADD COLUMN "tokenGracePercent" INTEGER;
