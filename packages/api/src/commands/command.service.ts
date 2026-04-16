import { Injectable } from '@nestjs/common';
import type {
  SessionCommand,
  SessionCommandContext,
  SessionCommandResult,
} from './session-command.js';

@Injectable()
export class CommandService {
  private readonly commands: ReadonlyMap<string, SessionCommand>;

  constructor(commands: SessionCommand[]) {
    const map = new Map<string, SessionCommand>();
    for (const cmd of commands) {
      map.set(cmd.name.toLowerCase(), cmd);
    }
    this.commands = map;
  }

  isCommand(text: string): boolean {
    const name = this.parseCommandName(text);
    return name !== null && this.commands.has(name);
  }

  async execute(text: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
    const name = this.parseCommandName(text);
    const command = name ? this.commands.get(name) : undefined;

    if (!command) {
      return { text: `Unknown command: ${text.trim()}. Type /help to see available commands.` };
    }

    const args = this.parseArgs(text);
    return command.execute({ ...ctx, args });
  }

  getAll(): readonly { readonly name: string; readonly description: string }[] {
    return [...this.commands.values()].map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  /**
   * Returns true if the text looks like a command attempt (starts with '/'
   * followed by a letter). Used by the router to intercept unknown commands
   * like '/foo' and return a friendly error instead of sending to the agent.
   */
  isSlashPrefixed(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length >= 2 && trimmed.startsWith('/') && trimmed[1] !== ' ';
  }

  private parseArgs(text: string): string | undefined {
    const trimmed = text.trim();
    const firstToken = trimmed.split(/\s/)[0]!;
    const rest = trimmed.slice(firstToken.length).trim();
    return rest.length > 0 ? rest : undefined;
  }

  private parseCommandName(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/') || trimmed.length < 2) {
      return null;
    }
    // No space allowed between '/' and command name
    if (trimmed[1] === ' ') {
      return null;
    }
    const firstToken = trimmed.split(/\s/)[0]!;
    return firstToken.slice(1).toLowerCase();
  }
}
