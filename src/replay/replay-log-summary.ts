import { YGOProYrp } from 'ygopro-yrp-encode';
import { YGOProStocReplay } from 'ygopro-msg-encode';

export type ReplayLogSummary = {
  replay: {
    compressed: boolean;
    byteLength?: number;
    responseCount: number;
    players: string[];
  };
};

type ReplayWithLogSummary = YGOProStocReplay & {
  replayLogSummary?: ReplayLogSummary;
};

export const createReplayLogSummary = (
  replay: YGOProYrp,
  byteLength?: number,
): ReplayLogSummary => ({
  replay: {
    compressed: replay.isCompressed,
    ...(byteLength == null ? {} : { byteLength }),
    responseCount: replay.responses.length,
    players: [
      replay.hostName,
      replay.tagHostName,
      replay.tagClientName,
      replay.clientName,
    ]
      .filter((name): name is string => !!name)
      .slice(0, 4),
  },
});

export const summarizeReplayMessage = (
  message: ReplayWithLogSummary,
): ReplayLogSummary =>
  message.replayLogSummary || createReplayLogSummary(message.replay);
