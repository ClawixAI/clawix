export interface Policy {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly maxTokenBudget: number | null;
  readonly maxAgents: number;
  readonly maxSkills: number;
  readonly maxGroupsOwned: number;
  readonly allowedProviders: readonly string[];
  readonly features: Record<string, unknown>;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
