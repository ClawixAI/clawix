import { Injectable } from '@nestjs/common';

/**
 * Per-user in-memory concurrency counter for shell_net runs. Dedicated instance
 * so shell_net concurrency is counted apart from python_run_net.
 */
@Injectable()
export class ShellNetConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  acquire(userId: string, cap: number): void {
    const cur = this.counts.get(userId) ?? 0;
    if (cur >= cap) {
      throw new Error(
        `Error: max concurrent shell_net runs (${cap}) reached. Wait for an in-flight run to finish.`,
      );
    }
    this.counts.set(userId, cur + 1);
  }

  release(userId: string): void {
    const cur = this.counts.get(userId);
    if (cur === undefined) return;
    if (cur <= 1) {
      this.counts.delete(userId);
    } else {
      this.counts.set(userId, cur - 1);
    }
  }
}
