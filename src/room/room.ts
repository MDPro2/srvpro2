import { Awaitable } from 'nfkit';
import { Context } from '../app';
import {
  HostInfo,
  NetPlayerType,
  PlayerChangeState,
  YGOProStocDuelStart,
  YGOProStocHsWatchChange,
  YGOProStocJoinGame,
} from 'ygopro-msg-encode';
import { DefaultHostInfoProvider } from './default-hostinfo-provder';
import { CardReaderFinalized } from 'koishipro-core.js';
import { YGOProResourceLoader } from '../services/ygopro-resource-loader';
import { blankLFList } from '../utility/blank-lflist';
import { Client } from '../client/client';
import { RoomMethod } from '../utility/decorators';
import { YGOProCtosDisconnect } from '../utility/ygopro-ctos-disconnect';
import { DuelStage } from './duel-stage';
import { OnRoomJoin } from './room-event/on-room-join';
import { OnRoomLeave } from './room-event/on-room-leave';
import { OnRoomWin } from './room-event/on-room-win';

export type RoomFinalizor = (self: Room) => Awaitable<any>;

export class Room {
  constructor(
    private ctx: Context,
    public name: string,
    private partialHostinfo: Partial<HostInfo> = {},
  ) {}

  hostinfo = this.ctx
    .get(() => DefaultHostInfoProvider)
    .parseHostinfo(this.name, this.partialHostinfo);

  get isTag() {
    return this.hostinfo.mode === 2;
  }

  players = new Array<Client>(this.hostinfo.mode === 2 ? 4 : 2);
  watchers = new Set<Client>();
  get playingPlayers() {
    return this.players.filter((p) => p);
  }
  get allPlayers() {
    return [...this.playingPlayers, ...this.watchers];
  }

  private get resourceLoader() {
    return this.ctx.get(() => YGOProResourceLoader);
  }
  private cardReader!: CardReaderFinalized;
  private lflist = blankLFList;

  private async findLFList() {
    const isTCG = this.hostinfo.rule === 1 && this.hostinfo.lflist === 0;
    let index = 0;
    for await (const lflist of this.resourceLoader.getLFLists()) {
      if (isTCG) {
        if (lflist.name?.includes(' TCG')) {
          return lflist;
        }
      } else {
        if (index === this.hostinfo.lflist) {
          return lflist;
        } else if (index > this.hostinfo.lflist) {
          return undefined;
        }
      }
      ++index;
    }
  }

  async init() {
    this.cardReader = await this.resourceLoader.getCardReader();
    if (this.hostinfo.lflist >= 0) {
      this.lflist = (await this.findLFList()) || blankLFList;
    }
    return this;
  }

  private finalizors: RoomFinalizor[] = [
    () => {
      this.allPlayers.forEach((p) => {
        p.disconnect();
        if (p.pos < NetPlayerType.OBSERVER) {
          this.players[p.pos] = undefined;
        }
      });
      this.watchers.clear();
    },
  ];

  addFinalizor(finalizor: RoomFinalizor, atEnd = false) {
    if (atEnd) {
      this.finalizors.unshift(finalizor);
    } else {
      this.finalizors.push(finalizor);
    }
    return this;
  }

  finalizing = false;
  async finalize() {
    if (this.finalizing) {
      return;
    }
    this.finalizing = true;
    while (this.finalizors.length) {
      const finalizor = this.finalizors.pop()!;
      await finalizor(this);
    }
  }

  get joinGameMessage() {
    return new YGOProStocJoinGame().fromPartial({
      info: {
        ...this.hostinfo,
        lflist: this.lflist === blankLFList ? 0 : this.lflist.getHash(),
      },
    });
  }

  get watcherSizeMessage() {
    return new YGOProStocHsWatchChange().fromPartial({
      watch_count: this.watchers.size,
    });
  }

  getTeammates(client: Client) {
    if (client.pos === NetPlayerType.OBSERVER) {
      return [];
    }
    if (this.isTag) {
      const teamBit = (c: Client) => c.pos & 0x1;
      return this.playingPlayers.filter((p) => teamBit(p) === teamBit(client));
    }
    return [];
  }

  getOpponents(client: Client) {
    if (client.pos === NetPlayerType.OBSERVER) {
      return [];
    }
    const teammates = new Set<Client>(this.getTeammates(client));
    return this.playingPlayers.filter((p) => !teammates.has(p));
  }

  getDuelPos(client: Client) {
    if (client.pos === NetPlayerType.OBSERVER) {
      return -1;
    }
    const teamOffsetBit = this.isTag ? 1 : 0;
    return (client.pos & (0x1 << teamOffsetBit)) >>> teamOffsetBit;
  }

  getPosPlayers(duelPos: number) {
    if (duelPos === NetPlayerType.OBSERVER) {
      return [...this.watchers];
    }
    return this.playingPlayers.filter((p) => this.getDuelPos(p) === duelPos);
  }

  async join(client: Client) {
    client.roomName = this.name;
    client.isHost = !this.allPlayers.length;
    const firstEmptyPlayerSlot = this.players.findIndex((p) => !p);
    if (firstEmptyPlayerSlot >= 0) {
      this.players[firstEmptyPlayerSlot] = client;
      client.pos = firstEmptyPlayerSlot;
    } else {
      this.watchers.add(client);
      client.pos = NetPlayerType.OBSERVER;
    }

    // send to client
    client.send(this.joinGameMessage);
    client.sendTypeChange();
    this.playingPlayers.forEach((p) => {
      client.send(p.prepareEnterPacket());
      // p.send(client.prepareEnterPacket());
      if (p.deck) {
        client.send(p.prepareChangePacket());
      }
    });
    if (this.watchers.size) {
      client.send(this.watcherSizeMessage);
    }

    // send to other players
    this.allPlayers
      .filter((p) => p !== client)
      .forEach((p) => {
        p.send(client.prepareEnterPacket());
      });

    await this.ctx.dispatch(new OnRoomJoin(this), client);
  }

  duelStage = DuelStage.Begin;
  score = [0, 0];

  async win(duelPos: number, winMatch = false) {
    if (this.duelStage === DuelStage.Siding) {
      this.playingPlayers
        .filter((p) => p.deck)
        .forEach((p) => p.send(new YGOProStocDuelStart()));
    }
    ++this.score[duelPos];
    // TODO: next game or finalize
    await this.ctx.dispatch(
      new OnRoomWin(this, duelPos, winMatch),
      this.getPosPlayers(duelPos)[0],
    );
  }

  @RoomMethod()
  async onDisconnect(client: Client, _msg: YGOProCtosDisconnect) {
    if (client.pos === NetPlayerType.OBSERVER) {
      this.watchers.delete(client);
      for (const p of this.allPlayers) {
        p.send(this.watcherSizeMessage);
      }
    } else if (this.duelStage === DuelStage.Begin) {
      this.players[client.pos] = undefined;
      this.allPlayers.forEach((p) => {
        p.send(client.prepareChangePacket(PlayerChangeState.LEAVE));
      });
    } else {
      this.score[this.getDuelPos(client)] = -9;
      await this.win(this.getDuelPos(client), true);
    }
    if (client.isHost) {
      const nextHost = this.allPlayers.find((p) => p !== client);
      if (nextHost) {
        nextHost.isHost = true;
        await nextHost.sendTypeChange();
      }
    }

    await this.ctx.dispatch(new OnRoomLeave(this), client);
    client.roomName = undefined;
  }
}
