import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Observable, filter, fromEvent, map } from 'rxjs';
import WebSocket, { RawData } from 'ws';
import { Context } from '../../app';
import { Client } from '../../client';

export class WsClient extends Client {
  constructor(
    ctx: Context,
    private sock: WebSocket,
    private req?: IncomingMessage,
  ) {
    super(ctx);
  }

  _send(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.send(data, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  _receive(): Observable<Buffer> {
    return fromEvent<[RawData, boolean]>(this.sock, 'message').pipe(
      filter(([, isBinary]) => isBinary),
      map(([data]) => {
        if (Buffer.isBuffer(data)) {
          return data;
        }
        if (Array.isArray(data)) {
          return Buffer.concat(data);
        }
        return Buffer.from(data);
      }),
    );
  }

  disconnect(): Promise<void> {
    if (this.sock.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.sock.once('close', () => resolve());
      this.sock.close();
    });
  }

  onDisconnect(): Observable<void> {
    return fromEvent<void>(this.sock, 'close');
  }

  physicalIp(): string {
    return (
      this.req?.socket.remoteAddress ??
      (this.sock as WebSocket & { _socket?: Socket })._socket?.remoteAddress ??
      ''
    );
  }

  xffIp(): string | undefined {
    const xff = this.req?.headers['x-forwarded-for'];
    if (!xff) {
      return undefined;
    }
    if (Array.isArray(xff)) {
      return xff[0];
    }
    return xff;
  }
}
