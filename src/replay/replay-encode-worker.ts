import { YGOProYrp } from 'ygopro-yrp-encode';
import { resolve } from 'node:path';
import {
  DefineWorker,
  toShared,
  TransportType,
  WorkerMethod,
} from 'yuzuthread';

const workerFilePath = process.env.JEST_WORKER_ID
  ? resolve(process.cwd(), '.test-dist/src/replay/replay-encode-worker.js')
  : __filename;

@DefineWorker({
  filePath: workerFilePath,
  id: 'srvpro2:ReplayEncodeWorker',
})
export class ReplayEncodeWorker {
  @WorkerMethod()
  @TransportType(() => Buffer)
  encode(@TransportType(() => YGOProYrp) replay: YGOProYrp): Buffer {
    const normalizedReplay = new YGOProYrp(replay);
    return toShared(Buffer.from(normalizedReplay.toYrp()));
  }
}
