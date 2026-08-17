import { ChatColor, YGOProCtosJoinGame } from 'ygopro-msg-encode';
import { LegacyStopService } from '../src/legacy-api';

function makeLogger() {
  return {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

function makeCtx(withDatabase = true) {
  const handlers: any[] = [];
  const logger = makeLogger();
  const apiService = {
    addApiMessageHandler: jest.fn(),
  };
  const repo = {
    findOne: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const ctx = {
    database: withDatabase
      ? {
          getRepository: jest.fn(() => repo),
        }
      : undefined,
    createLogger: () => logger,
    get: jest.fn(() => apiService),
    middleware: jest.fn((eventType, handler) => {
      handlers.push({ eventType, handler });
    }),
  };
  return { ctx: ctx as any, handlers, logger, repo };
}

function makeClient() {
  return {
    die: jest.fn(async () => undefined),
  };
}

describe('LegacyStopService', () => {
  test('does not query the database while memory is not stopped', async () => {
    const { ctx, handlers, repo } = makeCtx();
    repo.findOne.mockResolvedValue(null);
    const service = new LegacyStopService(ctx);
    await service.init();
    repo.findOne.mockClear();

    const client = makeClient();
    const next = jest.fn();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, next);
    await handlers[0].handler(new YGOProCtosJoinGame(), client, next);

    expect(repo.findOne).not.toHaveBeenCalled();
    expect(client.die).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  test('queries the database for every join while memory is stopped', async () => {
    const { ctx, handlers, repo } = makeCtx();
    repo.findOne.mockResolvedValue({ value: 'maintenance' });
    const service = new LegacyStopService(ctx);
    await service.init();
    repo.findOne.mockClear();

    const client = makeClient();
    const next = jest.fn();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, next);
    await handlers[0].handler(new YGOProCtosJoinGame(), client, next);

    expect(repo.findOne).toHaveBeenCalledTimes(2);
    expect(client.die).toHaveBeenCalledTimes(2);
    expect(client.die).toHaveBeenCalledWith('maintenance', ChatColor.RED);
    expect(next).not.toHaveBeenCalled();
  });

  test('uses the latest stop text from the database', async () => {
    const { ctx, handlers, repo } = makeCtx();
    repo.findOne
      .mockResolvedValueOnce({ value: 'old message' })
      .mockResolvedValueOnce({ value: 'new message' });
    const service = new LegacyStopService(ctx);
    await service.init();

    const client = makeClient();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, jest.fn());

    expect(service.getStopText()).toBe('new message');
    expect(client.die).toHaveBeenCalledWith('new message', ChatColor.RED);
  });

  test('clears memory and stops querying after the database recovers', async () => {
    const { ctx, handlers, repo } = makeCtx();
    repo.findOne
      .mockResolvedValueOnce({ value: 'maintenance' })
      .mockResolvedValueOnce(null);
    const service = new LegacyStopService(ctx);
    await service.init();

    const client = makeClient();
    const firstNext = jest.fn();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, firstNext);
    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(service.getStopText()).toBeUndefined();

    repo.findOne.mockClear();
    const secondNext = jest.fn();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, secondNext);

    expect(repo.findOne).not.toHaveBeenCalled();
    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(client.die).not.toHaveBeenCalled();
  });

  test('keeps memory stopped when the database query fails', async () => {
    const { ctx, handlers, logger, repo } = makeCtx();
    repo.findOne
      .mockResolvedValueOnce({ value: 'maintenance' })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const service = new LegacyStopService(ctx);
    await service.init();

    const client = makeClient();
    const next = jest.fn();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, next);

    expect(service.getStopText()).toBe('maintenance');
    expect(client.die).toHaveBeenCalledWith('maintenance', ChatColor.RED);
    expect(next).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Failed to refresh stop mode from database',
    );
  });

  test('keeps memory stopped when the database is disabled', async () => {
    const { ctx, handlers, logger } = makeCtx(false);
    const service = new LegacyStopService(ctx);
    await service.init();
    await service.setStopText('maintenance');

    const client = makeClient();
    const next = jest.fn();
    await handlers[0].handler(new YGOProCtosJoinGame(), client, next);

    expect(service.getStopText()).toBe('maintenance');
    expect(client.die).toHaveBeenCalledWith('maintenance', ChatColor.RED);
    expect(next).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Unable to refresh stop mode because database is unavailable',
    );
  });
});
