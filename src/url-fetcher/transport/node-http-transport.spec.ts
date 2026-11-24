import { Logger } from '@nestjs/common';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { UrlNotAllowedError } from '../errors/url-fetcher.errors';
import { SafeUrlFetcherService } from '../services/safe-url-fetcher.service';
import { OUTGOING_HEADERS } from '../url-fetcher.constants';
import { NodeHttpTransport } from './node-http-transport';

/**
 * Vrai serveur local sur 127.0.0.1 : il compte les connexions TCP reçues.
 * La politique d'adresses réelle est utilisée (aucun contournement) : le
 * serveur ne doit recevoir aucune connexion.
 */
describe('NodeHttpTransport : refus avant connexion', () => {
  let server: http.Server;
  let port: number;
  let connections: number;
  let requestsHandled: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      requestsHandled++;
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>secret interne</html>');
    });
    server.on('connection', () => {
      connections++;
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    connections = 0;
    requestsHandled = 0;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const request = (transport: NodeHttpTransport, url: string) =>
    transport.request({
      url: new URL(url),
      headers: OUTGOING_HEADERS,
      signal: new AbortController().signal,
      idleTimeoutMs: 2000,
    });

  const resolverTo = (...addresses: string[]) =>
    jest.fn().mockResolvedValue(
      addresses.map((address): LookupAddress => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    );

  it("refuse l'adresse 127.0.0.1 littérale : le serveur ne reçoit aucune connexion", async () => {
    const transport = new NodeHttpTransport(resolverTo('127.0.0.1'));

    await expect(
      request(transport, `http://127.0.0.1:${port}/`),
    ).rejects.toThrow(UrlNotAllowedError);

    expect(connections).toBe(0);
    expect(requestsHandled).toBe(0);
  });

  it('refuse un nom qui se résout vers 127.0.0.1 : aucune connexion', async () => {
    const resolver = resolverTo('127.0.0.1');
    const transport = new NodeHttpTransport(resolver);

    await expect(
      request(transport, `http://exemple.test:${port}/`),
    ).rejects.toThrow(UrlNotAllowedError);

    expect(resolver).toHaveBeenCalled();
    expect(connections).toBe(0);
    expect(requestsHandled).toBe(0);
  });

  it('refuse un nom dont une seule adresse est interdite : aucune connexion', async () => {
    const transport = new NodeHttpTransport(
      resolverTo('93.184.216.34', '127.0.0.1'),
    );

    await expect(
      request(transport, `http://exemple.test:${port}/`),
    ).rejects.toThrow(UrlNotAllowedError);

    expect(connections).toBe(0);
  });

  it('refuse un nom résolu vers une IPv6 IPv4-mappée interne : aucune connexion', async () => {
    const transport = new NodeHttpTransport(resolverTo('::ffff:7f00:1'));

    await expect(
      request(transport, `http://exemple.test:${port}/`),
    ).rejects.toThrow(UrlNotAllowedError);

    expect(connections).toBe(0);
  });

  it('le service refuse une URL vers le serveur local : aucune connexion', async () => {
    const service = new SafeUrlFetcherService(
      new NodeHttpTransport(resolverTo('127.0.0.1')),
    );

    await expect(service.fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      UrlNotAllowedError,
    );
    await expect(service.fetch(`http://localhost:${port}/`)).rejects.toThrow(
      UrlNotAllowedError,
    );

    expect(connections).toBe(0);
  });

  it('le service refuse un nom résolu vers le serveur local : aucune connexion', async () => {
    const service = new SafeUrlFetcherService(
      new NodeHttpTransport(resolverTo('127.0.0.1')),
    );

    // Port 80 : seule la politique d'adresse à la connexion protège ici.
    await expect(service.fetch('http://exemple.test/')).rejects.toThrow(
      UrlNotAllowedError,
    );

    expect(connections).toBe(0);
  });
});
