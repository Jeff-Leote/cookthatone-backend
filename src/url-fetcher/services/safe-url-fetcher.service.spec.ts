import { Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import {
  UrlFetchNetworkError,
  UrlFetchStatusError,
  UrlFetchTimeoutError,
  UrlFetchTooLargeError,
  UrlInvalidError,
  UrlNotAllowedError,
  UrlTooManyRedirectsError,
  UrlUnsupportedContentError,
} from '../errors/url-fetcher.errors';
import type {
  TransportRequest,
  TransportResponse,
  UrlFetchTransport,
} from '../transport/url-fetch-transport';
import { MAX_BODY_BYTES } from '../url-fetcher.constants';
import { SafeUrlFetcherService } from './safe-url-fetcher.service';

const HTML_HEADERS: IncomingHttpHeaders = {
  'content-type': 'text/html; charset=utf-8',
};

interface FakeResponse {
  statusCode?: number;
  headers?: IncomingHttpHeaders;
  chunks?: Array<Uint8Array | string>;
  body?: AsyncIterable<Uint8Array>;
}

function toResponse(spec: FakeResponse, destroy: jest.Mock): TransportResponse {
  const chunks = (spec.chunks ?? []).map((chunk) =>
    typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
  );
  return {
    statusCode: spec.statusCode ?? 200,
    headers: spec.headers ?? HTML_HEADERS,
    body:
      spec.body ??
      (async function* () {
        for (const chunk of chunks) {
          await Promise.resolve();
          yield chunk;
        }
      })(),
    destroy,
  };
}

function setup(responses: FakeResponse[]) {
  const requests: TransportRequest[] = [];
  const destroy = jest.fn();
  const queue = [...responses];
  const requestMock = jest.fn((request: TransportRequest) => {
    requests.push(request);
    const next = queue.shift();
    if (!next) return Promise.reject(new Error('aucune réponse prévue'));
    return Promise.resolve(toResponse(next, destroy));
  });
  return {
    service: new SafeUrlFetcherService({ request: requestMock }),
    requestMock,
    requests,
    destroy,
  };
}

const redirect = (location: string, statusCode = 302): FakeResponse => ({
  statusCode,
  headers: { location },
});

describe('SafeUrlFetcherService', () => {
  let warn: jest.SpyInstance;
  const loggedMessages = () =>
    (warn.mock.calls as unknown[][]).map((call) => String(call[0]));

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('cas nominaux', () => {
    it('renvoie la page HTML, son type et son URL finale', async () => {
      const { service } = setup([{ chunks: ['<html>', '<p>Crêpes</p>'] }]);

      await expect(
        service.fetch('https://exemple.fr/recette'),
      ).resolves.toEqual({
        finalUrl: 'https://exemple.fr/recette',
        contentType: 'text/html',
        html: '<html><p>Crêpes</p>',
      });
    });

    it('accepte application/xhtml+xml', async () => {
      const { service } = setup([
        {
          headers: { 'content-type': 'Application/XHTML+xml; charset=UTF-8' },
          chunks: ['<html/>'],
        },
      ]);

      const page = await service.fetch('https://exemple.fr/');
      expect(page.contentType).toBe('application/xhtml+xml');
    });

    it("suit une redirection simple et renvoie l'URL finale", async () => {
      const { service, requests } = setup([
        redirect('/nouvelle-page'),
        { chunks: ['ok'] },
      ]);

      const page = await service.fetch('https://exemple.fr/ancienne');

      expect(page.finalUrl).toBe('https://exemple.fr/nouvelle-page');
      expect(requests.map((request) => request.url.href)).toEqual([
        'https://exemple.fr/ancienne',
        'https://exemple.fr/nouvelle-page',
      ]);
    });

    it('suit exactement 3 redirections', async () => {
      const { service } = setup([
        redirect('/a'),
        redirect('/b', 301),
        redirect('https://autre.fr/c', 308),
        { chunks: ['ok'] },
      ]);

      const page = await service.fetch('https://exemple.fr/');
      expect(page.finalUrl).toBe('https://autre.fr/c');
    });

    it("n'envoie que la liste fixe d'en-têtes sortants", async () => {
      const { service, requests } = setup([{ chunks: ['ok'] }]);

      await service.fetch('https://exemple.fr/');

      const names = Object.keys(requests[0].headers).map((name) =>
        name.toLowerCase(),
      );
      expect(names.sort()).toEqual(['accept', 'accept-encoding', 'user-agent']);
      expect(requests[0].headers['Accept-Encoding']).toBe('identity');
      expect(names).not.toContain('cookie');
      expect(names).not.toContain('authorization');
    });

    it("ne renvoie pas les cookies d'une réponse lors de la redirection", async () => {
      const { service, requests } = setup([
        {
          statusCode: 302,
          headers: { location: '/suite', 'set-cookie': ['session=abc'] },
        },
        { chunks: ['ok'] },
      ]);

      await service.fetch('https://exemple.fr/');

      for (const request of requests) {
        expect(
          Object.keys(request.headers).map((name) => name.toLowerCase()),
        ).not.toContain('cookie');
      }
    });

    it('décode le charset annoncé', async () => {
      const latin1 = Buffer.from([0x63, 0x72, 0xea, 0x70, 0x65]); // « crêpe » en ISO-8859-1
      const { service } = setup([
        {
          headers: { 'content-type': 'text/html; charset="ISO-8859-1"' },
          chunks: [latin1],
        },
      ]);

      const page = await service.fetch('https://exemple.fr/');
      expect(page.html).toBe('crêpe');
    });

    it('retombe sur UTF-8 avec un charset inconnu, sans planter', async () => {
      const { service } = setup([
        {
          headers: { 'content-type': 'text/html; charset=charset-inconnu' },
          chunks: ['Crêpes'],
        },
      ]);

      const page = await service.fetch('https://exemple.fr/');
      expect(page.html).toBe('Crêpes');
    });

    it('accepte un en-tête Content-Encoding: identity', async () => {
      const { service } = setup([
        {
          headers: { ...HTML_HEADERS, 'content-encoding': 'identity' },
          chunks: ['ok'],
        },
      ]);

      await expect(service.fetch('https://exemple.fr/')).resolves.toBeDefined();
    });

    it('accepte un corps de taille maximale exacte', async () => {
      const { service } = setup([
        { chunks: [Buffer.alloc(MAX_BODY_BYTES, 0x61)] },
      ]);

      const page = await service.fetch('https://exemple.fr/');
      expect(page.html).toHaveLength(MAX_BODY_BYTES);
    });
  });

  describe("refus avant connexion (politique d'URL)", () => {
    it.each([
      ['ftp://exemple.fr/'],
      ['http://localhost/'],
      ['http://127.0.0.1/'],
      ['http://169.254.169.254/'],
      ['http://[::1]/'],
      ['https://u:p@exemple.fr/'],
      ['http://exemple.fr:8080/'],
    ])('refuse %s sans ouvrir de connexion', async (url) => {
      const { service, requestMock } = setup([]);

      await expect(service.fetch(url)).rejects.toThrow(UrlNotAllowedError);
      expect(requestMock).not.toHaveBeenCalled();
    });

    it.each([[''], ['pas une url']])(
      'refuse une URL invalide : "%s"',
      async (url) => {
        const { service, requestMock } = setup([]);

        await expect(service.fetch(url)).rejects.toThrow(UrlInvalidError);
        expect(requestMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('redirections', () => {
    it.each([
      ['http://127.0.0.1/admin'],
      ['http://169.254.169.254/latest/meta-data/'],
      ['http://[::ffff:7f00:1]/'],
      ['http://2130706433/'],
      ['http://localhost/'],
      ['file:///etc/passwd'],
      ['ftp://exemple.fr/'],
      ['https://exemple.fr:8443/'],
      ['https://u:p@exemple.fr/'],
    ])(
      'refuse une redirection vers %s sans ouvrir de seconde connexion',
      async (location) => {
        const { service, requests } = setup([
          redirect(location),
          { chunks: ['ne doit jamais être lu'] },
        ]);

        await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
          UrlNotAllowedError,
        );
        expect(requests).toHaveLength(1);
      },
    );

    it('refuse plus de 3 redirections (boucle)', async () => {
      const { service, requests } = setup([
        redirect('/1'),
        redirect('/2'),
        redirect('/3'),
        redirect('/4'),
        { chunks: ['ok'] },
      ]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlTooManyRedirectsError,
      );
      expect(requests).toHaveLength(4);
    });

    it('refuse une redirection sans en-tête Location', async () => {
      const { service } = setup([{ statusCode: 302, headers: {} }]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlFetchStatusError,
      );
    });

    it('referme la connexion de chaque réponse de redirection', async () => {
      const { service, destroy } = setup([redirect('/b'), { chunks: ['ok'] }]);

      await service.fetch('https://exemple.fr/a');

      expect(destroy).toHaveBeenCalledTimes(2);
    });
  });

  describe('contenu', () => {
    it.each([
      ['application/json'],
      ['application/pdf'],
      ['image/png'],
      ['text/plain'],
      [undefined],
      [''],
    ])('refuse le Content-Type %s avant de lire le corps', async (type) => {
      const read = jest.fn();
      const { service, destroy } = setup([
        {
          headers: type === undefined ? {} : { 'content-type': type },
          body: {
            [Symbol.asyncIterator]: () => {
              read();
              return {
                next: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
          },
        },
      ]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlUnsupportedContentError,
      );
      expect(read).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();
    });

    it.each([['gzip'], ['br'], ['deflate'], ['GZIP']])(
      'refuse Content-Encoding: %s',
      async (encoding) => {
        const { service } = setup([
          {
            headers: { ...HTML_HEADERS, 'content-encoding': encoding },
            chunks: ['x'],
          },
        ]);

        await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
          UrlUnsupportedContentError,
        );
      },
    );

    it.each([[404], [500], [403]])(
      'refuse le statut %s',
      async (statusCode) => {
        const { service } = setup([{ statusCode, chunks: ['x'] }]);

        await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
          UrlFetchStatusError,
        );
      },
    );
  });

  describe('taille', () => {
    it('refuse un Content-Length trop grand sans lire le corps', async () => {
      const { service, destroy } = setup([
        {
          headers: {
            ...HTML_HEADERS,
            'content-length': String(MAX_BODY_BYTES + 1),
          },
          chunks: ['x'],
        },
      ]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlFetchTooLargeError,
      );
      expect(destroy).toHaveBeenCalled();
    });

    it('coupe un flux qui dépasse 2 Mo sans Content-Length', async () => {
      let produced = 0;
      const chunk = Buffer.alloc(512 * 1024, 0x61);
      const { service, destroy } = setup([
        {
          body: (async function* () {
            for (let i = 0; i < 100; i++) {
              await Promise.resolve();
              produced++;
              yield chunk;
            }
          })(),
        },
      ]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlFetchTooLargeError,
      );
      expect(destroy).toHaveBeenCalled();
      // 4 blocs de 512 Ko = 2 Mo ; le 5e dépasse : la lecture s'arrête là.
      expect(produced).toBe(5);
    });

    it('coupe un flux qui dépasse malgré un Content-Length mensonger', async () => {
      const { service } = setup([
        {
          headers: { ...HTML_HEADERS, 'content-length': '10' },
          chunks: [Buffer.alloc(MAX_BODY_BYTES + 1)],
        },
      ]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlFetchTooLargeError,
      );
    });
  });

  describe('délais et échecs réseau', () => {
    it('lève une erreur de délai si la connexion ne répond jamais', async () => {
      jest.useFakeTimers();
      const requests: TransportRequest[] = [];
      const transport: UrlFetchTransport = {
        request: (request) => {
          requests.push(request);
          return new Promise(() => undefined);
        },
      };
      const service = new SafeUrlFetcherService(transport);

      const result = service.fetch('https://exemple.fr/');
      const assertion = expect(result).rejects.toThrow(UrlFetchTimeoutError);
      await jest.advanceTimersByTimeAsync(8000);

      await assertion;
      expect(requests[0].signal.aborted).toBe(true);
    });

    it('lève une erreur de délai si la lecture du corps traîne', async () => {
      jest.useFakeTimers();
      const { service, requests } = setup([
        {
          body: (async function* () {
            yield Buffer.from('début');
            await new Promise(() => undefined);
          })(),
        },
      ]);

      const result = service.fetch('https://exemple.fr/');
      const assertion = expect(result).rejects.toThrow(UrlFetchTimeoutError);
      await jest.advanceTimersByTimeAsync(8000);

      await assertion;
      expect(requests[0].signal.aborted).toBe(true);
    });

    it('le délai total couvre aussi les redirections', async () => {
      jest.useFakeTimers();
      let calls = 0;
      const transport: UrlFetchTransport = {
        request: () => {
          calls++;
          if (calls === 1) {
            return Promise.resolve(toResponse(redirect('/suite'), jest.fn()));
          }
          return new Promise(() => undefined);
        },
      };
      const service = new SafeUrlFetcherService(transport);

      const result = service.fetch('https://exemple.fr/');
      const assertion = expect(result).rejects.toThrow(UrlFetchTimeoutError);
      await jest.advanceTimersByTimeAsync(8000);

      await assertion;
      expect(calls).toBe(2);
    });

    it('convertit toute erreur inattendue du transport en erreur réseau générique', async () => {
      const transport: UrlFetchTransport = {
        request: () =>
          Promise.reject(new Error('connect ECONNREFUSED 10.0.0.12:443')),
      };
      const service = new SafeUrlFetcherService(transport);

      const error = (await service
        .fetch('https://exemple.fr/')
        .catch((e: unknown) => e)) as Error;

      expect(error).toBeInstanceOf(UrlFetchNetworkError);
      expect(error.message).toBe('Impossible de récupérer la page');
      expect(error.message).not.toContain('10.0.0.12');
    });

    it("conserve l'erreur de refus d'adresse remontée par le transport", async () => {
      const transport: UrlFetchTransport = {
        request: () => Promise.reject(new UrlNotAllowedError()),
      };
      const service = new SafeUrlFetcherService(transport);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlNotAllowedError,
      );
    });

    it('convertit une coupure pendant la lecture en erreur réseau', async () => {
      const { service } = setup([
        {
          body: (async function* () {
            yield Buffer.from('début');
            await Promise.resolve();
            throw new Error('socket hang up');
          })(),
        },
      ]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlFetchNetworkError,
      );
    });
  });

  describe('journalisation', () => {
    it("ne journalise jamais l'URL complète, seulement l'hôte", async () => {
      const { service } = setup([{ statusCode: 500 }]);

      await service
        .fetch('https://exemple.fr/recette?token=SECRET123#frag')
        .catch(() => undefined);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = loggedMessages()[0];
      expect(message).toContain('exemple.fr');
      expect(message).not.toContain('SECRET123');
      expect(message).not.toContain('/recette');
      expect(message).not.toContain('https://');
    });

    it('ne journalise pas une URL refusée avant connexion', async () => {
      const { service } = setup([]);

      await service
        .fetch('http://u:SECRET123@127.0.0.1/x')
        .catch(() => undefined);

      for (const message of loggedMessages()) {
        expect(message).not.toContain('SECRET123');
        expect(message).not.toContain('127.0.0.1');
      }
    });
  });
  describe('redirection entre http et https', () => {
    it('refuse de passer de https à http, sans ouvrir de seconde connexion', async () => {
      const { service, requests } = setup([
        redirect('http://exemple.fr/clair'),
        { chunks: ['ne doit jamais être lu'] },
      ]);

      const error = (await service
        .fetch('https://exemple.fr/')
        .catch((e: unknown) => e)) as Error;

      expect(error).toBeInstanceOf(UrlNotAllowedError);
      expect(error.message).toBe('Adresse non autorisée');
      expect(requests).toHaveLength(1);
    });

    it.each([
      ['http', 'http'],
      ['http', 'https'],
      ['https', 'https'],
    ])('autorise de %s vers %s', async (from, to) => {
      const { service, requests } = setup([
        redirect(`${to}://autre.fr/suite`),
        { chunks: ['ok'] },
      ]);

      const page = await service.fetch(`${from}://exemple.fr/`);

      expect(page.finalUrl).toBe(`${to}://autre.fr/suite`);
      expect(requests).toHaveLength(2);
    });
  });

  describe('statuts 3xx', () => {
    it.each([[301], [302], [303], [307], [308]])(
      'suit le statut %s',
      async (statusCode) => {
        const { service, requests } = setup([
          redirect('/suite', statusCode),
          { chunks: ['ok'] },
        ]);

        const page = await service.fetch('https://exemple.fr/');

        expect(page.finalUrl).toBe('https://exemple.fr/suite');
        expect(requests).toHaveLength(2);
      },
    );

    it.each([[300], [304], [305]])(
      'ne suit pas le statut %s même avec un en-tête Location',
      async (statusCode) => {
        const { service, requests } = setup([
          redirect('/suite', statusCode),
          { chunks: ['ne doit jamais être lu'] },
        ]);

        await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
          UrlFetchStatusError,
        );
        expect(requests).toHaveLength(1);
      },
    );
  });

  describe('minuteur du délai total', () => {
    beforeEach(() => jest.useFakeTimers());

    it('ne laisse aucun minuteur en attente après un succès', async () => {
      const { service } = setup([{ chunks: ['ok'] }]);

      await service.fetch('https://exemple.fr/');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('ne laisse aucun minuteur en attente après une erreur', async () => {
      const { service } = setup([{ statusCode: 500 }]);

      await expect(service.fetch('https://exemple.fr/')).rejects.toThrow(
        UrlFetchStatusError,
      );

      expect(jest.getTimerCount()).toBe(0);
    });

    it('ne laisse aucun minuteur en attente après un refus de politique', async () => {
      const { service } = setup([]);

      await expect(service.fetch('http://127.0.0.1/')).rejects.toThrow(
        UrlNotAllowedError,
      );

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
