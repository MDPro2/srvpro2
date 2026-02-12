import { createAppContext } from 'nfkit';
import { ConfigService } from './services/config';
import { Logger } from './services/logger';
import { Emitter } from './services/emitter';
import { SSLFinder } from './services/ssl-finder';
import { ClientHandler } from './services/client-handler';
import { IpResolver } from './services/ip-resolver';

const core = createAppContext()
  .provide(ConfigService, {
    merge: ['getConfig'],
  })
  .provide(Logger, { merge: ['createLogger'] })
  .provide(Emitter, { merge: ['dispatch', 'middleware', 'removeMiddleware'] })
  .define();

export type Context = typeof core;

export const app = core
  .provide(SSLFinder)
  .provide(IpResolver)
  .provide(ClientHandler)
  .define();
