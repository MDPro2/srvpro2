import { initWorker, type WorkerInstance } from 'yuzuthread';
import { Context } from '../app';
import { DuelRecord, DuelRecordReplayContext } from '../room';
import { createReplayLogSummary, ReplayLogSummary } from './replay-log-summary';
import { ReplayEncodeWorker } from './replay-encode-worker';
import { YGOProStocReplayCompressed } from './ygopro-stoc-replay-compressed';

type EncodedReplay = {
  payload: Buffer;
  summary: ReplayLogSummary;
};

type ReplayWorker = WorkerInstance<ReplayEncodeWorker>;
type ReplayWorkerPromise = Promise<ReplayWorker>;
export type ReplayWorkerFactory = () => ReplayWorkerPromise;

export class ReplayEncodeService {
  private logger = this.ctx.createLogger(this.constructor.name);
  private workerFactory: ReplayWorkerFactory = () =>
    initWorker(ReplayEncodeWorker);
  private workerPromise?: ReplayWorkerPromise;
  private completedReplayCache = new WeakMap<
    DuelRecord,
    Map<string, Promise<EncodedReplay>>
  >();

  constructor(private ctx: Context) {}

  init() {
    process.once('exit', () => {
      void this.finalize();
    });
  }

  async encodePayload(
    duelRecord: DuelRecord,
    replayContext: DuelRecordReplayContext,
  ): Promise<Buffer> {
    return (await this.encode(duelRecord, replayContext)).payload;
  }

  async encodePacket(
    duelRecord: DuelRecord,
    replayContext: DuelRecordReplayContext,
  ): Promise<YGOProStocReplayCompressed> {
    const encoded = await this.encode(duelRecord, replayContext);
    return new YGOProStocReplayCompressed(encoded.payload, encoded.summary);
  }

  async finalize(): Promise<void> {
    const workerPromise = this.workerPromise;
    this.workerPromise = undefined;
    if (!workerPromise) {
      return;
    }
    try {
      const worker = await workerPromise;
      await worker.finalize();
    } catch {
      // The worker has already failed or exited.
    }
  }

  private encode(
    duelRecord: DuelRecord,
    replayContext: DuelRecordReplayContext,
  ): Promise<EncodedReplay> {
    if (!duelRecord.endTime) {
      return this.encodeUncached(duelRecord, replayContext);
    }

    const cacheKey = this.getCacheKey(replayContext);
    let recordCache = this.completedReplayCache.get(duelRecord);
    if (!recordCache) {
      recordCache = new Map();
      this.completedReplayCache.set(duelRecord, recordCache);
    }

    const cached = recordCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const encoded = this.encodeUncached(duelRecord, replayContext).catch(
      (error) => {
        recordCache!.delete(cacheKey);
        throw error;
      },
    );
    recordCache.set(cacheKey, encoded);
    return encoded;
  }

  private async encodeUncached(
    duelRecord: DuelRecord,
    replayContext: DuelRecordReplayContext,
  ): Promise<EncodedReplay> {
    const replay = duelRecord.toYrp(replayContext);
    const payload = await this.encodeInWorker(replay);
    return {
      payload,
      summary: createReplayLogSummary(replay, payload.byteLength),
    };
  }

  private async encodeInWorker(
    replay: ReturnType<DuelRecord['toYrp']>,
  ): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const workerPromise = this.getWorker();
      try {
        const worker = await workerPromise;
        return await worker.encode(replay);
      } catch (error) {
        lastError = error;
        await this.discardWorker(workerPromise);
        this.logger.warn(
          { attempt: attempt + 1, error },
          'Replay encode worker failed',
        );
      }
    }
    throw lastError;
  }

  private getWorker(): ReplayWorkerPromise {
    this.workerPromise ||= this.workerFactory().catch((error) => {
      this.workerPromise = undefined;
      throw error;
    });
    return this.workerPromise;
  }

  private async discardWorker(workerPromise: ReplayWorkerPromise) {
    if (this.workerPromise === workerPromise) {
      this.workerPromise = undefined;
    }
    try {
      const worker = await workerPromise;
      await worker.finalize();
    } catch {
      // The worker is already unusable.
    }
  }

  private getCacheKey(replayContext: DuelRecordReplayContext) {
    return JSON.stringify({
      hostinfo: replayContext.hostinfo,
      isTag: replayContext.isTag,
    });
  }
}
