export interface SystemSettings {
  /** System-wide cap on cron token spend; null disables enforcement. */
  readonly cronDefaultTokenBudget: number | null;
  readonly cronExecutionTimeoutMs: number;
  readonly cronTokenGracePercent: number;
  readonly defaultTimezone: string;
}

export interface SystemSettingsRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly settings: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
