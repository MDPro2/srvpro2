import { Awaitable } from 'nfkit';
import { Context } from '../app';
import {
  HostInfo,
  NetPlayerType,
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

  players = new Array<Client>(this.hostinfo.mode === 2 ? 4 : 2);
  watchers = new Set<Client>();
  get allPlayers() {
    return [...this.players.filter((p) => p), ...this.watchers];
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
    await client.send(this.joinGameMessage);
    await client.sendTypeChange();
    for (let i = 0; i < this.players.length; ++i) {
      const p = this.players[i];
      if (p) {
        await client.send(p.prepareEnterPacket());
        await p.send(client.prepareEnterPacket());
        if (p.deck) {
          await client.send(p.prepareChangePacket());
        }
      }
    }
    if (this.watchers.size) {
      await client.send(this.watcherSizeMessage);
    }
  }

  duelStage = DuelStage.Begin;

  @RoomMethod()
  async onDisconnect(client: Client, _msg: YGOProCtosDisconnect) {
    if (client.pos === NetPlayerType.OBSERVER) {
      this.watchers.delete(client);
      for (const p of this.allPlayers) {
        p.send(this.watcherSizeMessage).then();
      }
    } else {
      this.players[client.pos] = undefined;
    }
    if (client.isHost) {
      const nextHost = this.allPlayers.find((p) => p !== client);
      if (nextHost) {
        nextHost.isHost = true;
        await nextHost.sendTypeChange();
      }
    }
    client.roomName = undefined;
  }
}
