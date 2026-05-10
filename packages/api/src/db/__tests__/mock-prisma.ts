import { vi } from 'vitest';

function createModelMock() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  };
}

export function createMockPrismaService() {
  return {
    policy: createModelMock(),
    user: createModelMock(),
    agentDefinition: createModelMock(),
    agentRun: createModelMock(),
    userAgent: createModelMock(),
    providerConfig: createModelMock(),
    channel: createModelMock(),
    message: createModelMock(),
    task: createModelMock(),
    taskRun: createModelMock(),
    taskRunMessage: createModelMock(),
    session: createModelMock(),
    auditLog: createModelMock(),
    tokenUsage: createModelMock(),
    group: createModelMock(),
    groupMember: createModelMock(),
    memoryItem: createModelMock(),
    memoryShare: createModelMock(),
    groupInvite: createModelMock(),
    notification: createModelMock(),
    systemSettings: createModelMock(),
  };
}

export type MockPrismaService = ReturnType<typeof createMockPrismaService>;
