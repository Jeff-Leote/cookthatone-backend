import { Logger } from '@nestjs/common';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  UrlFetchNetworkError,
  UrlFetchTimeoutError,
  UrlFetchTooLargeError,
} from '../errors/url-fetcher.errors';
import { SafeUrlFetcherService } from '../services/safe-url-fetcher.service';
import { MAX_BODY_BYTES, OUTGOING_HEADERS } from '../url-fetcher.constants';
import { NodeHttpTransport } from './node-http-transport';
import type { UrlFetchTransport } from './url-fetch-transport';

// Seul le test autorise 127.0.0.1 afin de vérifier le transport sur de vraies
// sockets, sans sortir sur Internet. Le code de production n'a aucun interrupteur.
jest.mock('../utils/ip-guard', () => {
  const actual =
    jest.requireActual<typeof import('../utils/ip-guard')>('../utils/ip-guard');
  return {
    ...actual,
    isForbiddenIp: (address: string) =>
      address === '127.0.0.1' ? false : actual.isForbiddenIp(address),
  };
});

describe('NodeHttpTransport : sockets réelles en local', () => {
  let server: http.Server;
  let port: number;
  let lastHeaders: http.IncomingHttpHeaders;
  let lastRawHeaders: string[];
  let lastUrl: string | undefined;
  let connectionCount = 0;
  const sockets = new Set<import('node:net').Socket>();

  const transport = new NodeHttpTransport(() =>
    Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  );

  const request = (path: string, idleTimeoutMs = 2000, signal?: AbortSignal) =>
    transport.request({
      url: new URL(`http://exemple.test:${port}${path}`),
      headers: OUTGOING_HEADERS,
      signal: signal ?? new AbortController().signal,
      idleTimeoutMs,
    });

  async function readAll(body: AsyncIterable<Uint8Array>): Promise<string> {
    const parts: Buffer[] = [];
    for await (const chunk of body) parts.push(Buffer.from(chunk));
    return Buffer.concat(parts).toString('utf-8');
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastHeaders = req.headers;
      lastRawHeaders = req.rawHeaders;
      lastUrl = req.url;
      if (req.url === '/lent') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('début');
        return; // le corps ne se termine jamais
      }
      if (req.url === '/redirige') {
        // Redirection dont le corps n'est jamais terminé : seule la fermeture
        // côté client libère la connexion.
        res.writeHead(302, { Location: '/page' });
        res.write('x');
        return;
      }
      if (req.url === '/gros') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        const pump = (): void => {
          let canWrite = true;
          while (canWrite && !res.destroyed) canWrite = res.write(chunk);
          if (!res.destroyed) res.once('drain', pump);
        };
        pump();
        return;
      }
      if (req.url === '/coupe') {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Length': '100',
        });
        res.write('début');
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'session=abc',
      });
      res.end('<p>Crêpes</p>');
    });
    server.on('connection', (socket) => {
      connectionCount++;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("récupère la page, avec le nom d'hôte dans Host et uniquement les en-têtes fixes", async () => {
    const response = await request('/page?a=1');

    expect(response.statusCode).toBe(200);
    expect(await readAll(response.body)).toBe('<p>Crêpes</p>');
    expect(lastUrl).toBe('/page?a=1');
    expect(lastHeaders.host).toBe(`exemple.test:${port}`);
    expect(lastHeaders['accept-encoding']).toBe('identity');
    expect(lastHeaders['user-agent']).toBe(OUTGOING_HEADERS['User-Agent']);
    const names = lastRawHeaders
      .filter((_, index) => index % 2 === 0)
      .map((name) => name.toLowerCase());
    expect(names).not.toContain('cookie');
    expect(names).not.toContain('authorization');
    expect(names.sort()).toEqual([
      'accept',
      'accept-encoding',
      'connection',
      'host',
      'user-agent',
    ]);
  });

  it('ne renvoie pas le cookie posé par le serveur à la requête suivante', async () => {
    const first = await request('/');
    await readAll(first.body);
    const second = await request('/');
    await readAll(second.body);

    expect(lastHeaders.cookie).toBeUndefined();
  });

  it('convertit une inactivité du corps en erreur de délai', async () => {
    const response = await request('/lent', 150);

    await expect(readAll(response.body)).rejects.toThrow(UrlFetchTimeoutError);
  });

  it('détruit la requête quand le signal est annulé', async () => {
    const controller = new AbortController();
    const response = await request('/lent', 5000, controller.signal);
    const reading = readAll(response.body);

    controller.abort();

    await expect(reading).rejects.toThrow(UrlFetchNetworkError);
  });

  it('convertit une coupure de connexion en erreur réseau générique', async () => {
    const response = await request('/coupe');

    await expect(readAll(response.body)).rejects.toThrow(UrlFetchNetworkError);
  });

  it('refuse tout de suite si le signal est déjà annulé, sans ouvrir de connexion', async () => {
    await settle();
    const before = connectionCount;
    const controller = new AbortController();
    controller.abort();

    await expect(request('/', 2000, controller.signal)).rejects.toThrow(
      UrlFetchTimeoutError,
    );

    // Laisse le temps à une connexion tardive d'arriver avant de conclure.
    await settle();
    expect(connectionCount - before).toBe(0);
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  async function waitForNoOpenSocket(): Promise<void> {
    const deadline = Date.now() + 3000;
    while (sockets.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sockets.size).toBe(0);
  }

  // Transport réel, mais l'hôte public est redirigé vers le serveur local : le service
  // valide « exemple.fr » (port standard) puis la connexion part vers 127.0.0.1.
  function serviceOnLocalServer(): SafeUrlFetcherService {
    const toLocal: UrlFetchTransport = {
      request: (req) =>
        transport.request({
          ...req,
          url: new URL(
            `http://exemple.test:${port}${req.url.pathname}${req.url.search}`,
          ),
        }),
    };
    return new SafeUrlFetcherService(toLocal);
  }

  it('ouvre une connexion neuve par requête (pas de réutilisation de socket)', async () => {
    await settle();
    const before = connectionCount;

    const first = await request('/page');
    await readAll(first.body);
    expect(lastHeaders.connection).toBe('close');
    const second = await request('/page');
    await readAll(second.body);
    expect(lastHeaders.connection).toBe('close');

    await settle();
    expect(connectionCount - before).toBe(2);
  });

  describe('fermeture des connexions', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => jest.restoreAllMocks());

    it('destroy() ferme la socket côté serveur', async () => {
      const response = await request('/lent');
      expect(sockets.size).toBeGreaterThan(0);

      response.destroy();

      await waitForNoOpenSocket();
    });

    it('referme la connexion de la réponse de redirection une fois lue', async () => {
      const page = await serviceOnLocalServer().fetch(
        'http://exemple.fr/redirige',
      );

      expect(page.html).toBe('<p>Crêpes</p>');
      await waitForNoOpenSocket();
    });

    it('referme la connexion quand le corps dépasse 2 Mo', async () => {
      const service = serviceOnLocalServer();

      await expect(service.fetch('http://exemple.fr/gros')).rejects.toThrow(
        UrlFetchTooLargeError,
      );

      expect(MAX_BODY_BYTES).toBe(2 * 1024 * 1024);
      await waitForNoOpenSocket();
    });
  });
});
