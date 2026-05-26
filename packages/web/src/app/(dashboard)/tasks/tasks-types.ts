// Shared types for the schedules (Tasks) page and its dialogs.

export type ScheduleType = 'cron' | 'every' | 'at';

export type ApiSchedule =
  | { readonly type: 'cron'; readonly expression: string; readonly tz?: string }
  | { readonly type: 'every'; readonly interval: string }
  | { readonly type: 'at'; readonly time: string };

export interface ApiTask {
  readonly id: string;
  readonly agentDefinitionId: string;
  readonly name: string;
  readonly prompt: string;
  readonly schedule: ApiSchedule;
  readonly enabled: boolean;
  readonly channelId: string | null;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastStatus: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiAgentDefinition {
  readonly id: string;
  readonly name: string;
}

export type ApiChannelType = 'web' | 'telegram' | 'whatsapp' | string;

export interface ApiChannel {
  readonly id: string;
  readonly type: ApiChannelType;
  readonly name: string;
  readonly isActive: boolean;
}

export interface ApiUserProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly telegramId: string | null;
  readonly whatsappJid: string | null;
}

export interface TaskFormState {
  agentDefinitionId: string;
  name: string;
  prompt: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  scheduleValue: string;
  timezone: string;
  channelId: string;
}
