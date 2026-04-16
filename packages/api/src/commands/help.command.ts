import { Injectable } from '@nestjs/common';
import type {
  SessionCommand,
  SessionCommandContext,
  SessionCommandResult,
} from './session-command.js';

/**
 * HelpCommand — lists all registered session commands.
 *
 * Receives a getter function instead of CommandService directly
 * to avoid a circular dependency (CommandService holds HelpCommand,
 * HelpCommand needs to read CommandService).
 */
@Injectable()
export class HelpCommand implements SessionCommand {
  readonly name = 'help';
  readonly description = 'Show available commands';

  private getCommands: () => readonly { readonly name: string; readonly description: string }[] =
    () => [];

  setCommandListGetter(
    getter: () => readonly { readonly name: string; readonly description: string }[],
  ): void {
    this.getCommands = getter;
  }

  async execute(_ctx: SessionCommandContext): Promise<SessionCommandResult> {
    const commands = this.getCommands();
    const lines = commands.map((cmd) => `/${cmd.name} - ${cmd.description}`);
    const text = `Available commands:\n${lines.join('\n')}`;
    return { text };
  }
}
