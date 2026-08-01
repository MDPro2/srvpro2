import { YGOProCtosJoinGame } from 'ygopro-msg-encode';
import { Context } from '../app';

export class JoinFallback {
  constructor(private ctx: Context) {}

  async init() {
    this.ctx.middleware(YGOProCtosJoinGame, async (msg, client, _next) => {
      return client.die('#{blank_room_name}');
    });
  }
}
