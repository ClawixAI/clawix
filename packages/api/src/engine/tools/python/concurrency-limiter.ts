import { Injectable } from '@nestjs/common';
import { PythonToolError } from './types.js';

@Injectable()
export class PythonConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  acquire(userId: string, cap: number): void {
    const cur = this.counts.get(userId) ?? 0;
    if (cur >= cap) {
      throw new PythonToolError(
        'CONCURRENCY_LIMIT',
        `Error: max concurrent python runs (${cap}) reached. Wait for an in-flight run to finish.`,
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
