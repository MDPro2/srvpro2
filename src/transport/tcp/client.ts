import { Socket } from 'node:net';
import { Observable, fromEvent } from 'rxjs';
import { Context } from '../../app';
import { Client } from '../../client';

export class TcpClient extends Client {
  constructor(
    ctx: Context,
    private sock: Socket,
  ) {
    super(ctx);
  }

  _send(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.write(data, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  _receive(): Observable<Buffer> {
    return fromEvent<Buffer>(this.sock, 'data');
  }

  disconnect(): Promise<void> {
    if (this.sock.destroyed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.sock.once('close', () => resolve());
      this.sock.end();
    });
  }

  onDisconnect(): Observable<void> {
    return fromEvent<void>(this.sock, 'close');
  }

  physicalIp(): string {
    return this.sock.remoteAddress ?? '';
  }

  xffIp(): string | undefined {
    return undefined;
  }
}
