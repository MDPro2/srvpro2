import JSZip from 'jszip';
import { CloudReplayService } from '../src/feats';
import { LegacyApiReplayService } from '../src/legacy-api';
import { LegacyRoomIdService } from '../src/legacy-api/legacy-room-id-service';
import { RoomManager } from '../src/room';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const makeService = (cloudReplayService: Record<string, jest.Mock>) => {
  const routes = new Map<string, (koaCtx: any) => Promise<void>>();
  const replay = { id: 42 };
  const queryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => [replay]),
  };
  const ctx: any = {
    createLogger: () => ({
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }),
    router: {
      get: jest.fn((path: string, handler: (koaCtx: any) => Promise<void>) => {
        routes.set(path, handler);
      }),
    },
    legacyApiAuth: {
      auth: jest.fn(async () => true),
    },
    database: {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder),
      })),
    },
  };
  ctx.get = jest.fn((factory: () => unknown) => {
    const token = factory();
    if (token === CloudReplayService) return cloudReplayService;
    if (token === LegacyRoomIdService) {
      return { getRoomIdString: jest.fn() };
    }
    if (token === RoomManager) {
      return { allRooms: jest.fn(() => []) };
    }
    return undefined;
  });
  return { service: new LegacyApiReplayService(ctx), routes };
};

const makeKoaCtx = () => {
  const headers = new Map<string, string>();
  return {
    query: {},
    params: {},
    state: {},
    headers,
    set: jest.fn((name: string, value: string) => headers.set(name, value)),
    body: undefined as unknown,
    status: 200,
  };
};

describe('LegacyApiReplayService worker encoding', () => {
  test('awaits worker payloads before generating archive.zip', async () => {
    const deferred = createDeferred<Buffer>();
    const cloudReplayService = {
      buildReplayYrpPayload: jest.fn(() => deferred.promise),
      getReplayYrpPayloadById: jest.fn(),
    };
    const { routes } = makeService(cloudReplayService);
    const koaCtx = makeKoaCtx();
    const handling = routes.get('/api/archive.zip')!(koaCtx);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cloudReplayService.buildReplayYrpPayload).toHaveBeenCalledWith({
      id: 42,
    });
    expect(koaCtx.body).toBeUndefined();

    const payload = Buffer.from('worker-encoded-replay');
    deferred.resolve(payload);
    await handling;

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (koaCtx.body as NodeJS.EventEmitter)
        .on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        .on('error', reject)
        .on('end', resolve);
    });
    const zip = await JSZip.loadAsync(Buffer.concat(chunks));
    await expect(zip.file('42.yrp')!.async('nodebuffer')).resolves.toEqual(
      payload,
    );
  });

  test('returns the awaited worker payload from the single replay route', async () => {
    const payload = Buffer.from('single-worker-replay');
    const cloudReplayService = {
      buildReplayYrpPayload: jest.fn(),
      getReplayYrpPayloadById: jest.fn(async () => payload),
    };
    const { routes } = makeService(cloudReplayService);
    const koaCtx = makeKoaCtx();
    koaCtx.params = { filename: '42.yrp' };

    await routes.get('/api/replay/:filename')!(koaCtx);

    expect(cloudReplayService.getReplayYrpPayloadById).toHaveBeenCalledWith(
      42,
      { includeDueling: true },
    );
    expect(koaCtx.body).toEqual(payload);
    expect(koaCtx.headers.get('Content-Disposition')).toBe(
      'attachment; filename="42.yrp"',
    );
  });
});
