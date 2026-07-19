import { Counter } from 'prom-client';

export const toolApprovalsTotal = new Counter({
  name: 'clawix_tool_approvals_total',
  help: 'Tool-approval outcomes',
  labelNames: ['outcome'] as const,
});

export const approvalExtractorErrorsTotal = new Counter({
  name: 'clawix_approval_extractor_errors_total',
  help: 'resource-scoped tools whose resourceKeyFromParams threw or returned empty',
});
