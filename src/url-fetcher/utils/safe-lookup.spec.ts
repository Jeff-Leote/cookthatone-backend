import type { LookupAddress } from 'node:dns';
import {
  UrlFetchNetworkError,
  UrlNotAllowedError,
} from '../errors/url-fetcher.errors';
import { createSafeLookup, type DnsResolver } from './safe-lookup';

const PUBLIC: LookupAddress = { address: '93.184.216.34', family: 4 };
const LOOPBACK: LookupAddress = { address: '127.0.0.1', family: 4 };

type Result = {
  error: Error | null;
  address: unknown;
  family: number | undefined;
};

function run(
  resolver: DnsResolver,
  options: { all?: boolean; family?: number },
): Promise<Result> {
  return new Promise((resolve) => {
    createSafeLookup(resolver)(
      'exemple.test',
      options,
      (error, address, family) => resolve({ error, address, family }),
    );
  });
}

describe('createSafeLookup', () => {
  it('refuse le nom si une seule adresse résolue est interdite (all: true)', async () => {
    const resolver = jest.fn().mockResolvedValue([PUBLIC, LOOPBACK]);
    const result = await run(resolver, { all: true });
    expect(result.error).toBeInstanceOf(UrlNotAllowedError);
    expect(result.error?.message).toBe('Adresse non autorisée');
  });

  it('refuse le nom si une seule adresse résolue est interdite (all: false)', async () => {
    const resolver = jest.fn().mockResolvedValue([LOOPBACK, PUBLIC]);
    const result = await run(resolver, { all: false });
    expect(result.error).toBeInstanceOf(UrlNotAllowedError);
  });

  it('refuse une adresse IPv6 interne', async () => {
    const resolver = jest
      .fn()
      .mockResolvedValue([{ address: '::ffff:7f00:1', family: 6 }]);
    const result = await run(resolver, { all: true });
    expect(result.error).toBeInstanceOf(UrlNotAllowedError);
  });

  it('accepte une adresse publique et renvoie un tableau avec all: true', async () => {
    const resolver = jest.fn().mockResolvedValue([PUBLIC]);
    const result = await run(resolver, { all: true });
    expect(result.error).toBeNull();
    expect(result.address).toEqual([PUBLIC]);
  });

  it('accepte une adresse publique et renvoie une seule adresse sans all', async () => {
    const resolver = jest.fn().mockResolvedValue([PUBLIC]);
    const result = await run(resolver, {});
    expect(result.error).toBeNull();
    expect(result.address).toBe('93.184.216.34');
    expect(result.family).toBe(4);
  });

  it('résout toujours avec all: true et transmet la famille demandée', async () => {
    const resolver = jest.fn().mockResolvedValue([PUBLIC]);
    await run(resolver, { all: false, family: 4 });
    expect(resolver).toHaveBeenCalledWith(
      'exemple.test',
      expect.objectContaining({ all: true, family: 4 }),
    );
  });

  it('renvoie une erreur réseau générique si la résolution échoue', async () => {
    const resolver = jest
      .fn()
      .mockRejectedValue(new Error('ENOTFOUND exemple.test 10.1.2.3'));
    const result = await run(resolver, { all: true });
    expect(result.error).toBeInstanceOf(UrlFetchNetworkError);
    expect(result.error?.message).not.toContain('10.1.2.3');
  });

  it("renvoie une erreur réseau si aucune adresse n'est résolue", async () => {
    const resolver = jest.fn().mockResolvedValue([]);
    const result = await run(resolver, { all: true });
    expect(result.error).toBeInstanceOf(UrlFetchNetworkError);
  });
  describe('rappel qui lève une exception', () => {
    // Le résolveur expose la promesse dérivée du `.then()` du lookup, pour vérifier
    // qu'elle ne rejette pas (un rejet non géré arrêterait le processus Node 22).
    function thenableResolver(addresses: LookupAddress[]) {
      const derived: Array<Promise<unknown>> = [];
      const resolver: DnsResolver = () =>
        ({
          then: (
            onFulfilled: (value: LookupAddress[]) => unknown,
            onRejected: (reason: unknown) => unknown,
          ) => {
            const result = Promise.resolve(addresses).then(
              onFulfilled,
              onRejected,
            );
            derived.push(result);
            return result;
          },
        }) as unknown as Promise<LookupAddress[]>;
      return { resolver, derived };
    }

    it.each([
      ['adresse publique, all: true', [PUBLIC], { all: true }],
      ['adresse publique, sans all', [PUBLIC], {}],
      ['adresse interdite', [LOOPBACK], { all: true }],
      ['aucune adresse', [], { all: true }],
    ])(
      'ne produit ni rejet non géré ni second appel (%s)',
      async (_cas, addresses, options) => {
        const { resolver, derived } = thenableResolver(addresses);
        const callback = jest.fn(() => {
          throw new Error('échec dans le rappel');
        });

        createSafeLookup(resolver)('exemple.test', options, callback);

        expect(derived).toHaveLength(1);
        await expect(derived[0]).resolves.toBeUndefined();
        expect(callback).toHaveBeenCalledTimes(1);
      },
    );
  });
});
