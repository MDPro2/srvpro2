import { Awaitable } from 'nfkit';
import { Context } from '../app';
import {
  HostInfo,
  NetPlayerType,
  PlayerChangeState,
  YGOProStocDuelStart,
  YGOProStocHsPlayerChange,
  YGOProStocHsWatchChange,
  YGOProStocJoinGame,
  YGOProCtosHsToObserver,
  YGOProCtosHsToDuelist,
  YGOProCtosKick,
  YGOProCtosHsNotReady,
  YGOProStocDeckCount,
  YGOProStocDeckCount_DeckInfo,
  YGOProStocSelectTp,
  YGOProStocSelectHand,
  ChatColor,
  YGOProCtosChat,
  YGOProMsgWin,
  YGOProCtosUpdateDeck,
  OcgcoreCommonConstants,
  YGOProStocErrorMsg,
  YGOProStocGameMsg,
  YGOProStocReplay,
  YGOProStocDuelEnd,
  YGOProStocChangeSide,
  YGOProStocWaitingSide,
  YGOProCtosTpResult,
  TurnPlayerResult,
} from 'ygopro-msg-encode';
import { DefaultHostInfoProvider } from './default-hostinfo-provder';
import { CardReaderFinalized } from 'koishipro-core.js';
import { YGOProResourceLoader } from './ygopro-resource-loader';
import { blankLFList } from '../utility/blank-lflist';
import { Client } from '../client/client';
import { RoomMethod } from '../utility/decorators';
import { YGOProCtosDisconnect } from '../utility/ygopro-ctos-disconnect';
import { DuelStage } from './duel-stage';
import { OnRoomJoin } from './room-event/on-room-join';
import { OnRoomLeave } from './room-event/on-room-leave';
import { OnRoomWin } from './room-event/on-room-win';
import { OnRoomJoinPlayer } from './room-event/on-room-join-player';
import { OnRoomJoinObserver } from './room-event/on-room-join-observer';
import { OnRoomLeavePlayer } from './room-event/on-room-leave-player';
import { OnRoomLeaveObserver } from './room-event/on-room-leave-observer';
import { OnRoomMatchStart } from './room-event/on-room-match-start';
import { OnRoomGameStart } from './room-event/on-room-game-start';
import YGOProDeck from 'ygopro-deck-encode';
import { checkDeck, checkChangeSide } from '../utility/check-deck';
import { DuelRecord } from './duel-record';
import { RoomEvent } from './room-event/room-event';
import { generateSeed } from '../utility/generate-seed';
import { OnRoomDuelStart } from './room-event/on-room-duel-start';

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

  get winMatchCount() {
    const firstbit = this.hostinfo.mode & 0x1;
    const remainingBits = (this.hostinfo.mode & 0xfc) >>> 1;
    return (firstbit | remainingBits) + 1;
  }

  get isTag() {
    return this.hostinfo.mode === 2;
  }

  get opt() {
    const DUEL_PSEUDO_SHUFFLE = 16;
    const DUEL_TAG_MODE = 32;
    let opt = 0;
    if (this.hostinfo.no_shuffle_deck) {
      opt |= DUEL_PSEUDO_SHUFFLE;
    }
    if (this.isTag) {
      opt |= DUEL_TAG_MODE;
    }
    return opt;
  }

  players = new Array<Client | undefined>(this.hostinfo.mode === 2 ? 4 : 2);
  watchers = new Set<Client>();
  get playingPlayers() {
    return this.players.filter((p) => p) as Client[];
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

  private async cleanPlayers(sendDuelEnd = false) {
    await Promise.all([
      ...this.allPlayers.map(async (p) => {
        await this.kick(p, sendDuelEnd);
        if (p.pos < NetPlayerType.OBSERVER) {
          this.players[p.pos] = undefined;
        }
      }),
      Promise.all(
        [...this.watchers].map(async (p) => await this.kick(p, sendDuelEnd)),
      ).then(() => this.watchers.clear()),
    ]);
  }

  private finalizors: RoomFinalizor[] = [() => this.cleanPlayers()];

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

  private resolvePos(clientOrPos: Client | number) {
    return typeof clientOrPos === 'number' ? clientOrPos : clientOrPos.pos;
  }

  getTeammates(clientOrPos: Client | number) {
    const pos = this.resolvePos(clientOrPos);
    if (pos === NetPlayerType.OBSERVER) {
      return [];
    }
    if (this.isTag) {
      const teamBit = (c: Client) => c.pos & 0x1;
      return this.playingPlayers.filter((p) => teamBit(p) === (pos & 0x1));
    }
    return [];
  }

  getOpponents(clientOrPos: Client | number) {
    const pos = this.resolvePos(clientOrPos);
    if (pos === NetPlayerType.OBSERVER) {
      return [];
    }
    const teammates = new Set<Client>(this.getTeammates(pos));
    return this.playingPlayers.filter((p) => !teammates.has(p));
  }

  private get teamOffsetBit() {
    return this.isTag ? 1 : 0;
  }

  getDuelPos(clientOrPos: Client | number) {
    const pos = this.resolvePos(clientOrPos);
    if (pos === NetPlayerType.OBSERVER) {
      return -1;
    }
    return (pos & (0x1 << this.teamOffsetBit)) >>> this.teamOffsetBit;
  }

  isPosSwapped = false;
  getSwappedPos(clientOrPos: Client | number) {
    const pos = this.resolvePos(clientOrPos);
    if (pos === NetPlayerType.OBSERVER || !this.isPosSwapped) {
      return pos;
    }
    return pos ^ (0x1 << this.teamOffsetBit);
  }

  getSwappedDuelPosByDuelPos(duelPos: number) {
    if ([0, 1].includes(duelPos) && this.isPosSwapped) {
      return 1 - duelPos;
    }
    return duelPos;
  }

  getSwappedDuelPos(clientOrPos: Client | number) {
    const duelPos = this.getDuelPos(clientOrPos);
    return this.getSwappedDuelPosByDuelPos(duelPos);
  }

  getDuelPosPlayers(duelPos: number) {
    if (duelPos === NetPlayerType.OBSERVER) {
      return [...this.watchers];
    }
    return this.playingPlayers.filter((p) => this.getDuelPos(p) === duelPos);
  }

  async join(client: Client) {
    client.roomName = this.name;
    client.isHost = !this.allPlayers.length;
    const firstEmptyPlayerSlot = this.players.findIndex((p) => !p);
    const isPlayer = firstEmptyPlayerSlot >= 0;

    if (isPlayer) {
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

    // 触发具体的加入事件
    if (isPlayer) {
      await this.ctx.dispatch(new OnRoomJoinPlayer(this), client);
    } else {
      await this.ctx.dispatch(new OnRoomJoinObserver(this), client);
    }
    return undefined;
  }

  duelStage = DuelStage.Begin;
  duelRecords: DuelRecord[] = [];
  get score() {
    return [0, 1].map(
      (p) => this.duelRecords.filter((d) => d.winPosition === p).length,
    );
  }

  async sendReplays(client: Client) {
    for (let i = 0; i < this.duelRecords.length; i++) {
      await client.sendChat(
        `#{replay_hint_part1}${i + 1}#{replay_hint_part2}`,
        ChatColor.BABYBLUE,
      );
      const duelRecord = this.duelRecords[i];
      await client.send(
        new YGOProStocReplay().fromPartial({
          replay: duelRecord.toYrp(this),
        }),
      );
    }
  }

  private async changeSide() {
    if (this.duelStage === DuelStage.Siding) {
      return;
    }
    this.duelStage = DuelStage.Siding;
    for (const p of this.playingPlayers) {
      p.deck = undefined;
      p.send(new YGOProStocChangeSide());
    }
    for (const p of this.watchers) {
      p.send(new YGOProStocWaitingSide());
    }
  }

  async win(winMsg: Partial<YGOProMsgWin>, forceWinMatch = false) {
    if (this.duelStage === DuelStage.Siding) {
      this.playingPlayers
        .filter((p) => !p.deck)
        .forEach((p) => p.send(new YGOProStocDuelStart()));
    }
    const duelPos = this.getSwappedDuelPosByDuelPos(winMsg.player!);
    this.isPosSwapped = false;
    await Promise.all(
      this.allPlayers.map((p) =>
        p.send(
          new YGOProStocGameMsg().fromPartial({
            msg: new YGOProMsgWin().fromPartial(winMsg),
          }),
        ),
      ),
    );
    const exactWinMsg = new YGOProMsgWin().fromPartial({
      ...winMsg,
      player: duelPos,
    });
    const lastDuelRecord = this.duelRecords[this.duelRecords.length - 1];
    if (lastDuelRecord) {
      lastDuelRecord.winPosition = duelPos;
    }
    const winMatch = forceWinMatch || this.score[duelPos] >= this.winMatchCount;
    if (!winMatch) {
      await this.changeSide();
    }
    await this.ctx.dispatch(
      new OnRoomWin(this, exactWinMsg, winMatch),
      this.getDuelPosPlayers(duelPos)[0],
    );
    if (winMatch) {
      await this.cleanPlayers(true);
      return this.finalize();
    }
  }

  async kick(client: Client, sendDuelEnd = false) {
    await this.sendReplays(client);
    if (
      sendDuelEnd &&
      this.duelStage !== DuelStage.Begin &&
      // don't send duel end when client didn't finish siding
      !(
        this.duelStage === DuelStage.Siding &&
        !client.deck &&
        client.pos < NetPlayerType.OBSERVER
      )
    ) {
      await client.send(new YGOProStocDuelEnd());
    }
    return client.disconnect();
  }

  @RoomMethod()
  private async onDisconnect(client: Client, _msg: YGOProCtosDisconnect) {
    if (this.duelStage === DuelStage.End || this.finalizing) {
      return;
    }
    const wasObserver = client.pos === NetPlayerType.OBSERVER;
    const oldPos = client.pos;

    if (wasObserver) {
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
      await this.win(
        { player: this.getSwappedDuelPos(client), type: 0x4 },
        true,
      );
    }
    if (client.isHost) {
      const nextHost = this.allPlayers.find((p) => p !== client);
      if (nextHost) {
        nextHost.isHost = true;
        await nextHost.sendTypeChange();
      }
    }

    await this.ctx.dispatch(new OnRoomLeave(this), client);

    // 触发具体的离开事件
    if (wasObserver) {
      await this.ctx.dispatch(new OnRoomLeaveObserver(this), client);
    } else {
      await this.ctx.dispatch(new OnRoomLeavePlayer(this, oldPos), client);
    }

    client.roomName = undefined;
  }

  @RoomMethod()
  private async onToObserver(client: Client, _msg: YGOProCtosHsToObserver) {
    // 游戏已经开始，不允许切换
    if (this.duelStage !== DuelStage.Begin) {
      return;
    }

    // 如果已经是观战者，直接返回
    if (client.pos === NetPlayerType.OBSERVER) {
      return;
    }

    // 保存原位置
    const oldPos = client.pos;

    // 发送 PlayerChange 给所有人
    const changeMsg = new YGOProStocHsPlayerChange().fromPartial({
      playerPosition: oldPos,
      playerState: PlayerChangeState.OBSERVE,
    });
    this.allPlayers.forEach((p) => p.send(changeMsg));

    // 从 players 移除
    this.players[client.pos] = undefined;
    client.pos = NetPlayerType.OBSERVER;

    // 添加到观战者
    this.watchers.add(client);

    // 发送 TypeChange 给客户端
    await client.sendTypeChange();

    // 发送观战者数量更新
    this.allPlayers.forEach((p) => p.send(this.watcherSizeMessage));

    // 触发事件
    await this.ctx.dispatch(new OnRoomLeavePlayer(this, oldPos), client);
    await this.ctx.dispatch(new OnRoomJoinObserver(this), client);
  }

  @RoomMethod()
  private async onToDuelist(client: Client, _msg: YGOProCtosHsToDuelist) {
    // 游戏已经开始，不允许切换
    if (this.duelStage !== DuelStage.Begin) {
      return;
    }

    // 查找空位
    const firstEmptyPlayerSlot = this.players.findIndex((p) => !p);
    if (firstEmptyPlayerSlot < 0) {
      // 没有空位
      return;
    }

    if (client.pos === NetPlayerType.OBSERVER) {
      // 从观战者切换到玩家
      this.watchers.delete(client);

      // 添加到玩家
      this.players[firstEmptyPlayerSlot] = client;
      client.pos = firstEmptyPlayerSlot;

      // 发送 PlayerEnter 给所有人
      const enterMsg = client.prepareEnterPacket();
      this.allPlayers.forEach((p) => p.send(enterMsg));

      // 发送 TypeChange 给客户端
      await client.sendTypeChange();

      // 发送观战者数量更新
      this.allPlayers.forEach((p) => p.send(this.watcherSizeMessage));

      // 触发事件
      await this.ctx.dispatch(new OnRoomLeaveObserver(this), client);
      await this.ctx.dispatch(new OnRoomJoinPlayer(this), client);
    } else if (this.isTag) {
      // TAG 模式下，已经是玩家，切换到另一个空位
      // 如果已经 ready，不允许切换
      if (client.deck) {
        return;
      }

      const oldPos = client.pos;

      // 从当前位置的下一个位置开始循环查找空位
      let nextPos = (oldPos + 1) % 4;
      while (this.players[nextPos]) {
        nextPos = (nextPos + 1) % 4;
      }

      // 移动到新位置
      this.players[oldPos] = undefined;
      this.players[nextPos] = client;
      client.pos = nextPos;

      // 发送 PlayerChange 给所有人
      const changeMsg = new YGOProStocHsPlayerChange().fromPartial({
        playerPosition: oldPos,
        playerState: nextPos,
      });
      this.allPlayers.forEach((p) => p.send(changeMsg));

      // 发送 TypeChange 给客户端
      await client.sendTypeChange();

      // 触发事件 (玩家切换位置)
      await this.ctx.dispatch(new OnRoomLeavePlayer(this, oldPos), client);
      await this.ctx.dispatch(new OnRoomJoinPlayer(this), client);
    }
  }

  @RoomMethod()
  private async onKick(client: Client, msg: YGOProCtosKick) {
    // 游戏已经开始，不允许踢人
    if (this.duelStage !== DuelStage.Begin) {
      return;
    }

    // 只有 host 可以踢人
    if (!client.isHost) {
      return;
    }

    // 不能踢自己
    if (client.pos === msg.pos) {
      return;
    }

    // 获取要踢的玩家
    const targetPlayer = this.players[msg.pos];
    if (!targetPlayer) {
      return;
    }

    // 踢出玩家
    return this.kick(targetPlayer);
  }

  @RoomMethod()
  private async onUpdateDeck(client: Client, msg: YGOProCtosUpdateDeck) {
    // 只有玩家可以更新卡组
    if (client.pos === NetPlayerType.OBSERVER) {
      return;
    }

    // 在 Siding 阶段已经准备好的玩家不能再更新
    if (this.duelStage === DuelStage.Siding && client.deck) {
      return;
    }

    // 不在 Begin 或 Siding 阶段不能更新卡组
    if (
      this.duelStage !== DuelStage.Begin &&
      this.duelStage !== DuelStage.Siding
    ) {
      return;
    }

    const deck = new YGOProDeck({
      main: [],
      extra: [],
      side: msg.deck.side,
    });
    // we have to distinguish main and extra deck cards
    for (const card of msg.deck.main) {
      const cardEntry = this.cardReader.apply(card);
      if (
        cardEntry?.type &&
        cardEntry.type & OcgcoreCommonConstants.TYPES_EXTRA_DECK
      ) {
        deck.extra.push(card);
      } else {
        deck.main.push(card);
      }
    }

    // Check deck if needed
    if (!this.hostinfo.no_check_deck) {
      let deckError;

      if (this.duelStage === DuelStage.Begin) {
        // First duel: check deck validity
        deckError = checkDeck(deck, this.cardReader, {
          ot: this.hostinfo.rule,
          lflist: this.lflist,
          minMain: parseInt(this.ctx.getConfig('DECK_MAIN_MIN', '40')),
          maxMain: parseInt(this.ctx.getConfig('DECK_MAIN_MAX', '60')),
          maxExtra: parseInt(this.ctx.getConfig('DECK_EXTRA_MAX', '15')),
          maxSide: parseInt(this.ctx.getConfig('DECK_SIDE_MAX', '15')),
          maxCopies: parseInt(this.ctx.getConfig('DECK_MAX_COPIES', '3')),
        });

        if (deckError) {
          client.send(
            new YGOProStocErrorMsg().fromPartial({
              msg: 1, // ERRMSG_DECKERROR
              code: deckError.toPayload(),
            }),
          );
          return;
        }
      } else if (this.duelStage === DuelStage.Siding) {
        // Side deck change: check if cards match original deck
        if (!client.startDeck) {
          return;
        }

        if (!checkChangeSide(client.startDeck, deck)) {
          client.send(
            new YGOProStocErrorMsg().fromPartial({
              msg: 1, // ERRMSG_DECKERROR
              code: 0,
            }),
          );
          return;
        }
      }
    }

    // Save deck
    client.deck = deck;

    // In Begin stage, also save as startDeck for side deck checking
    if (this.duelStage === DuelStage.Begin) {
      client.startDeck = deck;
      // TODO: In Begin stage, may need to send PlayerChange or auto-ready
    } else if (this.duelStage === DuelStage.Siding) {
      // In Siding stage, send DUEL_START to the player who submitted deck
      client.send(new YGOProStocDuelStart());

      // Check if all players have submitted their decks
      const allReady = this.playingPlayers.every((p) => p.deck);
      if (allReady) {
        return this.startGame(
          this.duelRecords[this.duelRecords.length - 1]?.winPosition,
        );
      }
    }
  }

  @RoomMethod()
  private async onUnready(client: Client, _msg: YGOProCtosHsNotReady) {
    // 游戏已经开始，不允许取消准备
    if (this.duelStage !== DuelStage.Begin) {
      return;
    }

    // 只有玩家可以取消准备
    if (client.pos === NetPlayerType.OBSERVER) {
      return;
    }

    // 清除 deck
    client.deck = undefined;
    client.startDeck = undefined;

    // 发送 PlayerChange 给所有人
    const changeMsg = client.prepareChangePacket(PlayerChangeState.NOTREADY);
    this.allPlayers.forEach((p) => p.send(changeMsg));
  }

  @RoomMethod()
  private async onChat(client: Client, msg: YGOProCtosChat) {
    return this.sendChat(msg.msg, this.getSwappedPos(client));
  }

  async sendChat(msg: string, type: number = ChatColor.BABYBLUE) {
    return Promise.all(this.allPlayers.map((p) => p.sendChat(msg, type)));
  }

  firstgoPlayer?: Client;

  private async toFirstGo(firstgoPos: number) {
    this.firstgoPlayer = this.getDuelPosPlayers(firstgoPos)[0];
    this.duelStage = DuelStage.FirstGo;
    this.firstgoPlayer.send(new YGOProStocSelectTp());
  }

  private async toFinger() {
    this.duelStage = DuelStage.Finger;
    const fingerPlayers = [0, 1].map((p) => this.getDuelPosPlayers(p)[0]);
    fingerPlayers.forEach((p) => {
      p.send(new YGOProStocSelectHand());
    });
  }

  async startGame(firstgoPos?: number) {
    if (![DuelStage.Finger, DuelStage.Siding].includes(this.duelStage)) {
      return false;
    }
    if (this.duelRecords.length === 0) {
      this.allPlayers.forEach((p) => p.send(new YGOProStocDuelStart()));
      const displayCountDecks = [0, 1].map(
        (p) => this.getDuelPosPlayers(p)[0].deck!,
      );
      const toDeckCount = (d: YGOProDeck) => {
        const res = new YGOProStocDeckCount_DeckInfo();
        res.main = d.main.length;
        res.extra = d.extra.length;
        res.side = d.side.length;
        return res;
      };
      [0, 1].forEach((p) => {
        const selfDeck = displayCountDecks[p];
        const otherDeck = displayCountDecks[1 - p];
        this.getDuelPosPlayers(p).forEach((c) => {
          c.send(
            new YGOProStocDeckCount().fromPartial({
              player0DeckCount: toDeckCount(selfDeck),
              player1DeckCount: toDeckCount(otherDeck),
            }),
          );
        });
      });
      this.watchers.forEach((c) => {
        c.send(
          new YGOProStocDeckCount().fromPartial({
            player0DeckCount: toDeckCount(displayCountDecks[0]),
            player1DeckCount: toDeckCount(displayCountDecks[1]),
          }),
        );
      });
    }

    if (firstgoPos != null && firstgoPos >= 0 && firstgoPos <= 1) {
      await this.toFirstGo(firstgoPos);
    } else {
      await this.toFinger();
    }

    // 触发事件
    if (this.duelRecords.length === 0) {
      // 触发比赛开始事件（第一局）
      await this.ctx.dispatch(
        new OnRoomMatchStart(this),
        this.playingPlayers[0],
      );
    }

    // 触发游戏开始事件（每局游戏）
    await this.ctx.dispatch(new OnRoomGameStart(this), this.playingPlayers[0]);

    return true;
  }

  @RoomMethod()
  private async onDuelStart(client: Client, msg: YGOProCtosTpResult) {
    if (this.duelStage !== DuelStage.FirstGo) {
      return;
    }
    if (client !== this.firstgoPlayer) {
      return;
    }
    this.isPosSwapped =
      (msg.res === TurnPlayerResult.FIRST) !== (this.getDuelPos(client) === 0);
    const duelRecord = new DuelRecord(
      generateSeed(),
      this.playingPlayers.map((p) => ({ name: p.name, deck: p.deck! })),
    );
    if (this.isPosSwapped) {
      this.playingPlayers.forEach((p) => {
        duelRecord.players[this.getSwappedDuelPos(p)] = {
          name: p.name,
          deck: p.deck!,
        };
      });
    }
    this.duelRecords.push(duelRecord);

    await this.ctx.dispatch(
      new OnRoomDuelStart(this),
      this.getDuelPosPlayers(this.getSwappedDuelPos(0))[0],
    );

    this.allPlayers.forEach((p) => p.sendChat('TODO: duel start'));
    return this.finalize();
  }
}
