import { Context } from '../app';
import { DirCardReader, searchYGOProResource } from 'koishipro-core.js';
import { YGOProLFList } from 'ygopro-lflist-encode';
import path from 'node:path';

export class YGOProResourceLoader {
  constructor(private ctx: Context) {}

  ygoproPaths = this.ctx.config
    .getStringArray('YGOPRO_PATH')
    .map((p) => path.resolve(process.cwd(), p))
    .flatMap((p) => [path.join(p, 'expansions'), p]);
  extraScriptPaths = this.ctx.config
    .getStringArray('EXTRA_SCRIPT_PATH')
    .map((p) => path.resolve(process.cwd(), p));

  private logger = this.ctx.createLogger(this.constructor.name);

  async getCardReader() {
    this.logger.debug(
      { ygoproPaths: this.ygoproPaths, sql: typeof this.ctx.SQL.Database },
      'Getting card reader',
    );
    return DirCardReader(this.ctx.SQL, ...this.ygoproPaths);
  }

  async *getLFLists() {
    for await (const file of searchYGOProResource(...this.ygoproPaths)) {
      const filename = path.basename(file.path);
      if (filename !== 'lflist.conf') {
        continue;
      }
      const buf = await file.read();
      const lflist = new YGOProLFList().fromText(
        Buffer.from(buf).toString('utf-8'),
      );
      for (const item of lflist.items) {
        yield item;
      }
    }
  }
}
