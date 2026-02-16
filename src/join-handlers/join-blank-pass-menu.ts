import {
  GameMode,
  NetPlayerType,
  YGOProCtosBase,
  YGOProCtosHsToDuelist,
  YGOProCtosJoinGame,
  YGOProCtosKick,
  YGOProStocHsPlayerEnter,
  YGOProStocJoinGame,
  YGOProStocTypeChange,
} from 'ygopro-msg-encode';
import { Context } from '../app';
import { Chnroute, Client, I18nService } from '../client';
import { Welcome } from '../feats';
import { DefaultHostinfo } from '../room';
import { resolvePanelPageLayout } from '../utility';

interface PanelMenuNode {
  [key: string]: string | PanelMenuNode;
}

type PanelMenuAction =
  | {
      type: 'entry';
      rawLabel: string;
      value: string | PanelMenuNode;
    }
  | {
      type: 'next';
      rawLabel: string;
      offset: number;
    }
  | {
      type: 'prev';
      rawLabel: string;
      offset: number;
    };

type PanelView = {
  actions: PanelMenuAction[];
  mode: GameMode;
  slotCount: number;
};

export class JoinBlankPassMenu {
  private logger = this.ctx.createLogger(this.constructor.name);
  private i18n = this.ctx.get(() => I18nService);
  private chnroute = this.ctx.get(() => Chnroute);
  private welcome = this.ctx.get(() => Welcome);
  private enabled = this.ctx.config.getBoolean('ENABLE_MENU');
  private rootMenu = this.loadRootMenu();

  constructor(private ctx: Context) {
    if (!this.enabled) {
      return;
    }
    if (!this.rootMenu || !Object.keys(this.rootMenu).length) {
      this.logger.warn('MENU is empty or invalid, panel feature disabled');
      return;
    }

    this.ctx.middleware(
      YGOProCtosBase,
      async (msg, client, next) => {
        const bypassEstablished =
          msg instanceof YGOProCtosJoinGame && msg.bypassEstablished;
        if (!client.isInPanel) {
          return next();
        }
        if (bypassEstablished) {
          return next();
        }
        if (msg instanceof YGOProCtosHsToDuelist || msg instanceof YGOProCtosKick) {
          return next();
        }
        return undefined;
      },
      true,
    );

    this.ctx.middleware(YGOProCtosJoinGame, async (msg, client, next) => {
      msg.pass = (msg.pass || '').trim();
      if (msg.pass) {
        if (client.isInPanel) {
          this.exitPanel(client);
        }
        return next();
      }

      if (client.isInPanel) {
        this.exitPanel(client);
        return next();
      }

      this.enterPanel(client, msg);
      await this.welcome.sendConfigWelcome(client);
      await this.renderPanel(client);
      return msg;
    });

    this.ctx.middleware(YGOProCtosHsToDuelist, async (_msg, client, next) => {
      if (!client.isInPanel) {
        return next();
      }
      await this.renderPanel(client);
      return _msg;
    });

    this.ctx.middleware(YGOProCtosKick, async (msg, client, next) => {
      if (!client.isInPanel) {
        return next();
      }
      await this.handlePanelKick(client, Number(msg.pos));
      return undefined;
    });
  }

  private loadRootMenu() {
    const raw = this.ctx.config.getString('MENU').trim();
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.parseMenuNode(parsed, 'MENU');
    } catch (e) {
      this.logger.warn(
        { error: (e as Error).message },
        'Failed to parse MENU config',
      );
      return undefined;
    }
  }

  private parseMenuNode(value: unknown, path: string): PanelMenuNode {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${path} must be a JSON object`);
    }
    const parsed: PanelMenuNode = {};
    for (const [label, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof entryValue === 'string') {
        parsed[label] = entryValue;
        continue;
      }
      if (
        entryValue &&
        typeof entryValue === 'object' &&
        !Array.isArray(entryValue)
      ) {
        parsed[label] = this.parseMenuNode(entryValue, `${path}.${label}`);
        continue;
      }
      throw new Error(`${path}.${label} must be a string or object`);
    }
    return parsed;
  }

  private enterPanel(client: Client, msg: YGOProCtosJoinGame) {
    client.isInPanel = true;
    client.panelMenuPath = [];
    client.panelOffset = 0;
    client.panelJoinVersion = msg.version;
    client.panelJoinGameId = msg.gameid;
  }

  private exitPanel(client: Client) {
    client.isInPanel = false;
    client.panelMenuPath = undefined;
    client.panelOffset = undefined;
    client.panelJoinVersion = undefined;
    client.panelJoinGameId = undefined;
  }

  private resolveCurrentMenu(client: Client) {
    if (!this.rootMenu) {
      return undefined;
    }
    let node = this.rootMenu;
    const path = client.panelMenuPath || [];
    for (const key of path) {
      const next = node[key];
      if (!next || typeof next === 'string') {
        return undefined;
      }
      node = next;
    }
    return node;
  }

  private ensureCurrentMenu(client: Client) {
    let menu = this.resolveCurrentMenu(client);
    if (menu) {
      return menu;
    }
    client.panelMenuPath = [];
    client.panelOffset = 0;
    menu = this.resolveCurrentMenu(client);
    return menu;
  }

  private buildPanelView(client: Client): PanelView {
    const menu = this.ensureCurrentMenu(client);
    if (!menu) {
      return {
        actions: [],
        mode: GameMode.SINGLE,
        slotCount: 2,
      };
    }

    const entries = Object.entries(menu).map(([rawLabel, value]) => ({
      rawLabel,
      value,
    }));
    if (entries.length <= 2) {
      return {
        actions: entries.map((entry) => ({
          type: 'entry',
          rawLabel: entry.rawLabel,
          value: entry.value,
        })),
        mode: GameMode.SINGLE,
        slotCount: 2,
      };
    }
    if (entries.length <= 4) {
      return {
        actions: entries.map((entry) => ({
          type: 'entry',
          rawLabel: entry.rawLabel,
          value: entry.value,
        })),
        mode: GameMode.TAG,
        slotCount: 4,
      };
    }

    const layout = resolvePanelPageLayout(entries.length, client.panelOffset || 0);
    client.panelOffset = layout.pageStart;
    const pageActions: PanelMenuAction[] = [];

    if (layout.isFirstPage) {
      for (const entry of entries.slice(layout.pageStart, layout.pageStart + 3)) {
        pageActions.push({
          type: 'entry',
          rawLabel: entry.rawLabel,
          value: entry.value,
        });
      }
      pageActions.push({
        type: 'next',
        rawLabel: '#{menu_next_page}',
        offset: layout.pageStarts[layout.pageIndex + 1],
      });
    } else if (layout.isLastPage) {
      pageActions.push({
        type: 'prev',
        rawLabel: '#{menu_prev_page}',
        offset: layout.pageStarts[layout.pageIndex - 1],
      });
      for (const entry of entries.slice(layout.pageStart, layout.pageStart + 3)) {
        pageActions.push({
          type: 'entry',
          rawLabel: entry.rawLabel,
          value: entry.value,
        });
      }
    } else {
      pageActions.push({
        type: 'prev',
        rawLabel: '#{menu_prev_page}',
        offset: layout.pageStarts[layout.pageIndex - 1],
      });
      for (const entry of entries.slice(layout.pageStart, layout.pageStart + 2)) {
        pageActions.push({
          type: 'entry',
          rawLabel: entry.rawLabel,
          value: entry.value,
        });
      }
      pageActions.push({
        type: 'next',
        rawLabel: '#{menu_next_page}',
        offset: layout.pageStarts[layout.pageIndex + 1],
      });
    }

    return {
      actions: pageActions,
      mode: GameMode.TAG,
      slotCount: 4,
    };
  }

  private async translateLabel(client: Client, label: string) {
    const locale = this.chnroute.getLocale(client.ip);
    return String(await this.i18n.translate(locale, label));
  }

  private async renderPanel(client: Client) {
    const view = this.buildPanelView(client);
    if (!view.actions.length) {
      client.disconnect();
      return;
    }

    await client.send(
      new YGOProStocJoinGame().fromPartial({
        info: {
          ...DefaultHostinfo,
          mode: view.mode,
        },
      }),
    );
    await client.send(
      new YGOProStocTypeChange().fromPartial({
        type: NetPlayerType.OBSERVER | 0x10,
      }),
    );

    for (let i = 0; i < view.slotCount; i++) {
      const action = view.actions[i];
      const translated = action
        ? await this.translateLabel(client, action.rawLabel)
        : '';
      await client.send(
        new YGOProStocHsPlayerEnter().fromPartial({
          name: translated.slice(0, 20),
          pos: i,
        }),
      );
    }
  }

  private async handlePanelKick(client: Client, index: number) {
    const view = this.buildPanelView(client);
    const selected = view.actions[index];
    if (!selected) {
      await this.renderPanel(client);
      return;
    }

    if (selected.type === 'next' || selected.type === 'prev') {
      client.panelOffset = selected.offset;
      await this.renderPanel(client);
      return;
    }

    if (typeof selected.value === 'string') {
      await this.dispatchJoinGameFromPanel(client, selected.value);
      return;
    }

    const nextMenuKeys = Object.keys(selected.value);
    if (!nextMenuKeys.length) {
      await this.backFromPanel(client);
      return;
    }

    client.panelMenuPath = [...(client.panelMenuPath || []), selected.rawLabel];
    client.panelOffset = 0;
    await this.renderPanel(client);
  }

  private async backFromPanel(client: Client) {
    const currentPath = [...(client.panelMenuPath || [])];
    if (!currentPath.length) {
      client.disconnect();
      return;
    }
    currentPath.pop();
    client.panelMenuPath = currentPath;
    client.panelOffset = 0;
    await this.renderPanel(client);
  }

  private async dispatchJoinGameFromPanel(client: Client, pass: string) {
    const joinMsg = new YGOProCtosJoinGame().fromPartial({
      version: client.panelJoinVersion || this.ctx.config.getInt('YGOPRO_VERSION'),
      gameid: client.panelJoinGameId || 0,
      pass,
    });

    joinMsg.bypassEstablished = true;
    await this.ctx.dispatch(joinMsg, client);
  }
}

declare module '../client' {
  interface Client {
    isInPanel?: boolean;
    panelMenuPath?: string[];
    panelOffset?: number;
    panelJoinVersion?: number;
    panelJoinGameId?: number;
  }
}
