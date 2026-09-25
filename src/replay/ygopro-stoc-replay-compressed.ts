import { YGOProStocReplay } from 'ygopro-msg-encode';
import { ReplayLogSummary } from './replay-log-summary';

export class YGOProStocReplayCompressed extends YGOProStocReplay {
  constructor(
    private readonly compressedReplay: Buffer,
    public readonly replayLogSummary: ReplayLogSummary,
  ) {
    super();
  }

  toPayload(): Uint8Array {
    return this.compressedReplay;
  }

  copy(): this {
    return new YGOProStocReplayCompressed(
      this.compressedReplay,
      this.replayLogSummary,
    ) as this;
  }

  toJSON(): ReplayLogSummary {
    return this.replayLogSummary;
  }
}
