import { RedisService } from './redis.service';

describe('RedisService', () => {
  function buildService(keyBatches: string[][]) {
    const client = {
      scanStream: jest.fn().mockReturnValue(keyBatches),
      del: jest.fn().mockResolvedValue(1),
    };
    const service = new RedisService();
    (service as unknown as { client: typeof client }).client = client;
    return { service, client };
  }

  it('deletes every key matching the prefix across scan batches', async () => {
    const { service, client } = buildService([
      ['recipes:user-1:a:1:20', 'recipes:user-1::1:20'],
      [],
      ['recipes:user-1:b:1:20'],
    ]);

    await service.deleteByPrefix('recipes:user-1:');

    expect(client.scanStream).toHaveBeenCalledWith({
      match: 'recipes:user-1:*',
      count: 100,
    });
    expect(client.del).toHaveBeenCalledTimes(2);
    expect(client.del).toHaveBeenNthCalledWith(
      1,
      'recipes:user-1:a:1:20',
      'recipes:user-1::1:20',
    );
    expect(client.del).toHaveBeenNthCalledWith(2, 'recipes:user-1:b:1:20');
  });

  it('does not call del when nothing matches', async () => {
    const { service, client } = buildService([[]]);

    await service.deleteByPrefix('recipes:user-1:');

    expect(client.del).not.toHaveBeenCalled();
  });
});
