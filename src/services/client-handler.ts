import {
  YGOProCtosExternalAddress,
  YGOProCtosPlayerInfo,
} from 'ygopro-msg-encode';
import { Context } from '../app';
import { Client } from '../client';
import { IpResolver } from './ip-resolver';
import { WsClient } from '../transport/ws/client';

export class ClientHandler {
  constructor(private ctx: Context) {}

  private logger = this.ctx.createLogger('ClientHandler');

  async handleClient(client: Client): Promise<void> {
    try {
      const first = await client.waitForMessage([
        YGOProCtosPlayerInfo,
        YGOProCtosExternalAddress,
      ]);
      let playerInfo: YGOProCtosPlayerInfo;

      if (first instanceof YGOProCtosExternalAddress) {
        if (!(client instanceof WsClient)) {
          this.ctx.get(IpResolver).setClientIp(client, first.real_ip);
        }
        playerInfo = await client.waitForMessage([YGOProCtosPlayerInfo]);
      } else {
        if (!(client instanceof WsClient)) {
          this.ctx.get(IpResolver).setClientIp(client);
        }
        playerInfo = first;
      }

      client.name_vpass = playerInfo.name;
      const [name, vpass] = playerInfo.name.split('$');
      client.name = name;
      client.vpass = vpass || '';

      client.receive().subscribe(async (msg) => {
        try {
          await this.ctx.dispatch(msg, client);
        } catch (e) {
          this.logger.warn(
            `Error dispatching message ${msg.constructor.name} from ${client.loggingIp()}: ${(e as Error).message}`,
          );
        }
      });
    } catch {
      client.disconnect().then();
    }
  }
}
