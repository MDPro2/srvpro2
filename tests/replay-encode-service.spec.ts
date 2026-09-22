import YGOProDeck from 'ygopro-deck-encode';
import { DefaultHostinfo, DuelRecord } from '../src/room';
import { ReplayEncodeService } from '../src/replay';

const makeCtx = () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
});

const replayContext = {
  hostinfo: { ...DefaultHostinfo },
  isTag: false,
};

const makeRecord = (completed: boolean) => {
  const record = new DuelRecord(
    Array.from({ length: 32 }, () => 1),
    [
      { name: 'Alice', deck: new YGOProDeck({ main: [1] }) },
      { name: 'Bob', deck: new YGOProDeck({ main: [2] }) },
    ],
    false,
  );
  record.responses = [Buffer.from([1, 2, 3])];
  if (completed) {
    record.endTime = new Date('2026-09-22T00:01:00Z');
  }
  return record;
};

const makeWorker = (encode: jest.Mock) => ({
  encode,
  finalize: jest.fn(async () => undefined),
  workerStatus: jest.fn(),
});

describe('ReplayEncodeService', () => {
  test('deduplicates concurrent encoding for a completed DuelRecord', async () => {
    const service = new ReplayEncodeService(makeCtx() as any);
    const encode = jest.fn(async () => Buffer.from([1, 2, 3]));
    const worker = makeWorker(encode);
    (service as any).workerFactory = jest.fn(async () => worker);
    const record = makeRecord(true);

    const [payload, packet] = await Promise.all([
      service.encodePayload(record, replayContext),
      service.encodePacket(record, replayContext),
    ]);

    expect(encode).toHaveBeenCalledTimes(1);
    expect(packet.toPayload()).toBe(payload);
    await service.finalize();
  });

  test('does not cache an unfinished DuelRecord', async () => {
    const service = new ReplayEncodeService(makeCtx() as any);
    const encode = jest.fn(async () => Buffer.from([1]));
    const worker = makeWorker(encode);
    (service as any).workerFactory = jest.fn(async () => worker);
    const record = makeRecord(false);

    await service.encodePayload(record, replayContext);
    await service.encodePayload(record, replayContext);

    expect(encode).toHaveBeenCalledTimes(2);
    await service.finalize();
  });

  test('recreates a failed worker and retries once', async () => {
    const service = new ReplayEncodeService(makeCtx() as any);
    const failedWorker = makeWorker(
      jest.fn(async () => {
        throw new Error('worker failed');
      }),
    );
    const recoveredWorker = makeWorker(
      jest.fn(async () => Buffer.from([9, 8, 7])),
    );
    const workerFactory = jest
      .fn()
      .mockResolvedValueOnce(failedWorker)
      .mockResolvedValueOnce(recoveredWorker);
    (service as any).workerFactory = workerFactory;

    await expect(
      service.encodePayload(makeRecord(true), replayContext),
    ).resolves.toEqual(Buffer.from([9, 8, 7]));
    expect(workerFactory).toHaveBeenCalledTimes(2);
    expect(failedWorker.finalize).toHaveBeenCalledTimes(1);
    await service.finalize();
  });

  test('evicts a rejected completed-record cache entry', async () => {
    const service = new ReplayEncodeService(makeCtx() as any);
    const encodeInWorker = jest
      .fn()
      .mockRejectedValueOnce(new Error('encode failed'))
      .mockResolvedValueOnce(Buffer.from([4, 5, 6]));
    (service as any).encodeInWorker = encodeInWorker;
    const record = makeRecord(true);

    await expect(service.encodePayload(record, replayContext)).rejects.toThrow(
      'encode failed',
    );
    await expect(service.encodePayload(record, replayContext)).resolves.toEqual(
      Buffer.from([4, 5, 6]),
    );
    expect(encodeInWorker).toHaveBeenCalledTimes(2);
  });
});
