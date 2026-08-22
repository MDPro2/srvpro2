import { Context } from '../app';

export class OcgcoreInitLimiter {
  private running = 0;
  private waiters: Array<() => void> = [];
  private logger = this.ctx.createLogger(this.constructor.name);

  constructor(private ctx: Context) {}

  private get maxConcurrency() {
    const configured = this.ctx.config.getInt('OCGCORE_INIT_CONCURRENCY');
    return Number.isFinite(configured) && configured > 0 ? configured : 1;
  }

  get pendingCount() {
    return this.waiters.length;
  }

  get runningCount() {
    return this.running;
  }

  needsWait() {
    return this.running >= this.maxConcurrency;
  }

  async acquire(options: { onWait?: () => Promise<void> | void } = {}) {
    if (this.needsWait()) {
      await options.onWait?.();
      this.logger.debug(
        {
          running: this.running,
          maxConcurrency: this.maxConcurrency,
          queuePosition: this.waiters.length + 1,
        },
        'Waiting for OCGCore initialization slot',
      );
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    } else {
      this.running++;
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next();
        return;
      }
      this.running = Math.max(0, this.running - 1);
    };
  }
}
