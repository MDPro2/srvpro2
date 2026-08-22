import { OcgcoreInitLimiter } from '../src/room';

function makeCtx(concurrency: number) {
  return {
    createLogger: () => ({
      debug: jest.fn(),
    }),
    config: {
      getInt: (key: string) =>
        key === 'OCGCORE_INIT_CONCURRENCY' ? concurrency : 0,
    },
  } as any;
}

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('OcgcoreInitLimiter', () => {
  test('limits concurrent acquisitions and advances queued waiters', async () => {
    const limiter = new OcgcoreInitLimiter(makeCtx(2));

    const release1 = await limiter.acquire();
    const release2 = await limiter.acquire();
    let thirdAcquired = false;
    const third = limiter.acquire().then((release) => {
      thirdAcquired = true;
      return release;
    });

    await flushMicrotasks();

    expect(limiter.runningCount).toBe(2);
    expect(limiter.pendingCount).toBe(1);
    expect(thirdAcquired).toBe(false);

    release1();
    const release3 = await third;

    expect(thirdAcquired).toBe(true);
    expect(limiter.runningCount).toBe(2);
    expect(limiter.pendingCount).toBe(0);

    release2();
    release3();

    expect(limiter.runningCount).toBe(0);
  });

  test('falls back to one concurrent initialization for invalid config', async () => {
    const limiter = new OcgcoreInitLimiter(makeCtx(0));

    const release1 = await limiter.acquire();
    const second = limiter.acquire();

    await flushMicrotasks();

    expect(limiter.runningCount).toBe(1);
    expect(limiter.pendingCount).toBe(1);

    release1();
    const release2 = await second;
    release2();

    expect(limiter.runningCount).toBe(0);
  });
});
