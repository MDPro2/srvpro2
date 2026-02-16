import { ChatColor } from 'ygopro-msg-encode';
import { Context } from '../app';
import { Client } from '../client';
import { OnRoomJoin } from '../room/room-event/on-room-join';

declare module '../room' {
  interface Room {
    welcome: string;
    welcome2: string;
  }
}

declare module '../client' {
  interface Client {
    configWelcomeSent?: boolean;
  }
}

export class Welcome {
  private welcomeMessage = this.ctx.config.getString('WELCOME');

  constructor(private ctx: Context) {
    this.ctx.middleware(OnRoomJoin, async (event, client, next) => {
      const room = event.room;
      await this.sendConfigWelcome(client);
      if (room.welcome) {
        await client.sendChat(room.welcome, ChatColor.BABYBLUE);
      }
      if (room.welcome2) {
        await client.sendChat(room.welcome2, ChatColor.PINK);
      }
      return next();
    });
  }

  async sendConfigWelcome(client: Client) {
    if (!this.welcomeMessage || client.configWelcomeSent) {
      return;
    }
    client.configWelcomeSent = true;
    await client.sendChat(this.welcomeMessage, ChatColor.GREEN);
  }
}
