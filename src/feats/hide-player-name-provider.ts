import { NetPlayerType, YGOProStocHsPlayerEnter } from 'ygopro-msg-encode';
import { Context } from '../app';
import { DuelStage, OnRoomGameStart, RoomManager } from '../room';

declare module '../room' {
  interface Room {
    hidePlayerNames?: boolean;
  }
}

export class HidePlayerNameProvider {
  private roomManager = this.ctx.get(() => RoomManager);
  private hidePlayerNameMode = this.resolveMode();

  constructor(private ctx: Context) {}

  async init() {
    if (!this.enabled) {
      return;
    }

    this.ctx.middleware(YGOProStocHsPlayerEnter, async (msg, client, next) => {
      if (!client.roomName) {
        return next();
      }
      const room = this.roomManager.findByName(client.roomName);
      if (!room?.hidePlayerNames || !this.shouldHide(room.duelStage)) {
        return next();
      }
      const pos = msg.pos ?? -1;
      if (
        pos < 0 ||
        pos >= NetPlayerType.OBSERVER ||
        pos === client.pos ||
        !msg.name
      ) {
        return next();
      }

      msg.name = `Player ${pos + 1}`;
      return next();
    });

    this.ctx.middleware(OnRoomGameStart, async (event, _client, next) => {
      if (
        this.hidePlayerNameMode !== 1 ||
        !event.room.hidePlayerNames ||
        event.room.duelRecords.length !== 0
      ) {
        return next();
      }

      for (const sightPlayer of event.room.allPlayers) {
        for (const player of event.room.playingPlayers) {
          if (player === sightPlayer) {
            continue;
          }
          await sightPlayer.send(
            new YGOProStocHsPlayerEnter().fromPartial({
              name: player.name,
              pos: player.pos,
            }),
            true,
          );
        }
      }
      return next();
    });
  }

  get enabled() {
    return this.hidePlayerNameMode > 0;
  }

  private shouldHide(stage: DuelStage) {
    if (this.hidePlayerNameMode === 2) {
      return true;
    }
    return this.hidePlayerNameMode === 1 && stage === DuelStage.Begin;
  }

  private resolveMode() {
    const mode = this.ctx.config.getInt('HIDE_PLAYER_NAME');
    if (mode === 1 || mode === 2) {
      return mode;
    }
    return 0;
  }
}
