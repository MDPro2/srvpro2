import {
  ChatColor,
  YGOProCtosJoinGame,
  YGOProStocErrorMsg,
} from 'ygopro-msg-encode';
import { Context } from '../app';
import { convertNumberArray } from '../utility/convert-string-array';

const YGOPRO_VERSION = 0x1362;

export class ClientVersionCheck {
  private altVersions = convertNumberArray(this.ctx.getConfig('ALT_VERSIONS'));

  version = parseInt(
    this.ctx.getConfig('YGOPRO_VERSION', YGOPRO_VERSION.toString()),
  );

  constructor(private ctx: Context) {
    this.ctx.middleware(
      YGOProCtosJoinGame,
      async (msg, client, next) => {
        if (msg.version === this.version) {
          return next();
        }
        if (this.altVersions.includes(msg.version)) {
          await client.sendChat('#{version_polyfilled}', ChatColor.BABYBLUE);
          return next();
        }
        await client.sendChat('#{update_required}', ChatColor.RED);
        await client.send(
          new YGOProStocErrorMsg().fromPartial({
            msg: 4,
            code: this.version,
          }),
        );
        return client.disconnect();
      },
      true,
    );
  }
}
