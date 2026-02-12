import {
  filter,
  firstValueFrom,
  merge,
  Observable,
  Subject,
  timeout,
  TimeoutError,
} from 'rxjs';
import { take } from 'rxjs/operators';
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
import { Chnroute } from './services/chnroute';

export abstract class Client {
  protected abstract _send(data: Buffer): Promise<void>;
  protected abstract _receive(): Observable<Buffer<ArrayBufferLike>>;
  protected abstract _disconnect(): Promise<void>;
  protected abstract _onDisconnect(): Observable<void>;
  abstract physicalIp(): string;

  ip = '';
  isLocal = false;

  private logger = this.ctx.createLogger(this.constructor.name);
  private receiveSubject?: Subject<YGOProCtosBase>;
  private disconnectSubject = new Subject<void>();
  private manuallyDisconnected = false;

  constructor(protected ctx: Context) {}

  init() {
    this.onDisconnect().subscribe(() => {
      if (this.receiveSubject) {
        this.receiveSubject.complete();
        this.receiveSubject = undefined;
      }
    });
  }

  async disconnect(): Promise<void> {
    this.manuallyDisconnected = true;
    this.disconnectSubject.next();
    this.disconnectSubject.complete();
    await this._disconnect();
  }

  onDisconnect(): Observable<void> {
    if (this.manuallyDisconnected) {
      return this.disconnectSubject.asObservable();
    }
    return merge(
      this.disconnectSubject.asObservable(),
      this._onDisconnect(),
    ).pipe(take(1));
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

  async sendChat(msg: string, type = ChatColor.BABYBLUE) {
    return this.send(
      new YGOProStocChat().fromPartial({
        msg: await this.ctx
          .get(I18nService)
          .translate(this.ctx.get(Chnroute).getLocale(this.ip), msg),
        player_type: type,
      }),
    );
  }

  async die(msg?: string, type = ChatColor.BABYBLUE) {
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

  name = '';
  vpass = '';
  name_vpass = '';
}
