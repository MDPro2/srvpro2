import { YGOProCtosJoinGame } from 'ygopro-msg-encode';
import { Context } from '../app';

const YGOPRO_VERSION = 0x1362;

export class ClientVersionCheck {
  private altVersions = this.ctx
    .getConfig('ALT_VERSIONS', '')
    .split(',')
    .map((v) => parseInt(v.trim()))
    .filter((v) => v);

  constructor(private ctx: Context) {
    this.ctx.middleware(YGOProCtosJoinGame, async (msg, client, next) => {
      if (msg.version === YGOPRO_VERSION) {
        return next();
      }
    });
  }
}
