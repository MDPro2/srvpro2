import { createAppContext } from 'nfkit';
import { ContextState } from '../app';
import { ClientVersionCheck } from '../feats';
import { JoinWindbotAi, JoinWindbotToken } from '../feats/windbot';
import { JoinRoom } from './join-room';
import { JoinRoomIp } from './join-room-ip';
import { CloudReplayJoinHandler } from './cloud-replay-join-handler';
import { JoinFallback } from './fallback';
import { JoinPrechecks } from './join-prechecks';
import { RandomDuelJoinHandler } from './random-duel-join-handler';
import { BadwordPlayerInfoChecker } from './badword-player-info-checker';
import { JoinBlankPassRandomDuel } from './join-blank-pass-random-duel';
import { JoinBlankPassWindbotAi } from './join-blank-pass-windbot-ai';
import { JoinBlankPassMenu } from './join-blank-pass-menu';
import { JoinRoomlist } from './join-roomlist';
import { JoinBotlist } from './join-botlist';
import { ChallongeJoinHandler } from './challonge-join-handler';

export const JoinHandlerModule = createAppContext<ContextState>()
  .provide(ClientVersionCheck)
  .provide(JoinPrechecks)
  .provide(JoinWindbotToken)
  .provide(BadwordPlayerInfoChecker)
  .provide(JoinRoomIp) // IP
  .provide(CloudReplayJoinHandler) // R, R#, W, W#, YRP#
  .provide(JoinRoomlist) // L
  .provide(JoinWindbotAi) // AI, AI#
  .provide(JoinBotlist) // B
  .provide(ChallongeJoinHandler) // any
  .provide(RandomDuelJoinHandler) // M, T
  .provide(JoinRoom) // room pass
  .provide(JoinBlankPassMenu) // blank pass below
  .provide(JoinBlankPassRandomDuel)
  .provide(JoinBlankPassWindbotAi)
  .provide(JoinFallback)
  .define();
