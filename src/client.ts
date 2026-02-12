import {
  filter,
  firstValueFrom,
  Observable,
  Subject,
  timeout,
  TimeoutError,
} from 'rxjs';
import { Context } from './app';
import {
  YGOProCtos,
  YGOProStocBase,
  YGOProCtosBase,
  YGOProStocChat,
  ChatColor,
  YGOProStocErrorMsg,
} from 'ygopro-msg-encode';
import { YGOProProtoPipe } from './utility/ygopro-proto-pipe';
import { ClassType } from 'nfkit';
import { I18nService } from './services/i18n';

export abstract class Client {
  protected abstract _send(data: Buffer): Promise<void>;
  protected abstract _receive(): Observable<Buffer<ArrayBufferLike>>;
  abstract disconnect(): Promise<void>;
  abstract onDisconnect(): Observable<void>;
  abstract physicalIp(): string;

  ip = '';
  isLocal = false;

  private logger = this.ctx.createLogger(`Client ${this.physicalIp()}`);
  private receiveSubject?: Subject<YGOProCtosBase>;

  constructor(protected ctx: Context) {
    // Subscribe to disconnect event to clean up subject
    this.onDisconnect().subscribe(() => {
      if (this.receiveSubject) {
        this.receiveSubject.complete();
        this.receiveSubject = undefined;
      }
    });
  }

  async send(data: YGOProStocBase) {
    try {
      await this._send(Buffer.from(data.toFullPayload()));
    } catch (e) {
      this.logger.warn(
        { ip: this.loggingIp(), error: (e as Error).message },
        `Failed to send message: ${(e as Error).message}`,
      );
    }
  }

  async sendChat(msg: string, type: number) {
    return this.send(
      new YGOProStocChat().fromPartial({
        msg: await this.ctx.get(I18nService).translate('en-US', msg),
        player_type: type,
      }),
    );
  }

  async die(msg?: string, type?: number) {
    if (msg) {
      await this.sendChat(msg, type || ChatColor.BABYBLUE);
    }
    await this.send(
      new YGOProStocErrorMsg().fromPartial({
        msg: 1,
        code: 9,
      }),
    );
    this.disconnect().then();
  }

  loggingIp() {
    return this.ip || this.physicalIp() || 'unknown';
  }

  receive(): Observable<YGOProCtosBase> {
    // Create subject on first call and reuse it
    if (!this.receiveSubject) {
      this.receiveSubject = new Subject<YGOProCtosBase>();

      this._receive()
        .pipe(
          YGOProProtoPipe(YGOProCtos, {
            onError: (error) => {
              this.logger.warn(
                { ip: this.loggingIp() },
                `Protocol decode error: ${error.message}`,
              );
            },
          }),
          filter((msg) => {
            if (!msg) {
              this.logger.warn(
                { ip: this.loggingIp() },
                `Received invalid message, skipping`,
              );
              return false;
            }
            return true;
          }),
        )
        .subscribe({
          next: (data) => this.receiveSubject?.next(data!),
          error: (err) => this.receiveSubject?.error(err),
          complete: () => this.receiveSubject?.complete(),
        });
    }

    return this.receiveSubject.asObservable();
  }

  /**
   * Wait for a message of any of the specified types
   * @param types Array of message classes to wait for
   * @param timeoutMs Timeout in milliseconds (default: 5000)
   * @returns Promise that resolves with the matching message
   * @throws Error if timeout is reached
   */
  async waitForMessage<const C extends ClassType<YGOProCtosBase>[]>(
    types: C,
    timeoutMs = 5000,
  ): Promise<InstanceType<C[number]>> {
    try {
      return (await firstValueFrom(
        this.receive().pipe(
          filter((msg) => types.some((type) => msg instanceof type)) as any,
          timeout(timeoutMs),
        ),
      )) as InstanceType<C[number]>;
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new Error(
          `Timeout waiting for message after ${timeoutMs}ms (IP: ${this.loggingIp()})`,
        );
      }
      throw err;
    }
  }

  name = '';
  vpass = '';
  name_vpass = '';
}
