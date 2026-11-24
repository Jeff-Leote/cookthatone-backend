import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import {
  UrlFetchNetworkError,
  UrlFetchTimeoutError,
  UrlFetcherError,
  UrlNotAllowedError,
} from '../errors/url-fetcher.errors';
import { isForbiddenIp, stripBrackets } from '../utils/ip-guard';
import { createSafeLookup, type DnsResolver } from '../utils/safe-lookup';
import type {
  TransportRequest,
  TransportResponse,
  UrlFetchTransport,
} from './url-fetch-transport';

const MAX_HEADER_BYTES = 16 * 1024;

/**
 * Transport de production : une connexion neuve par requête (pas de pool, donc
 * le `lookup` de sécurité s'applique à chaque connexion et à chaque redirection).
 * Le nom d'hôte reste utilisé pour le SNI et l'en-tête `Host`.
 */
export class NodeHttpTransport implements UrlFetchTransport {
  private readonly lookup: LookupFunction;

  constructor(resolver?: DnsResolver) {
    this.lookup = createSafeLookup(resolver);
  }

  request({
    url,
    headers,
    signal,
    idleTimeoutMs,
  }: TransportRequest): Promise<TransportResponse> {
    return new Promise<TransportResponse>((resolve, reject) => {
      // Node ouvrirait quand même la connexion : on s'arrête avant.
      if (signal.aborted) {
        reject(new UrlFetchTimeoutError());
        return;
      }
      const hostname = stripBrackets(url.hostname);
      // Un hôte littéral n'est pas résolu par Node : il est contrôlé ici.
      if (isIP(hostname) !== 0 && isForbiddenIp(hostname)) {
        reject(new UrlNotAllowedError());
        return;
      }

      const isHttps = url.protocol === 'https:';
      let idleTimedOut = false;
      let responded = false;

      const request = (isHttps ? https : http).request(
        {
          hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { ...headers },
          agent: false,
          lookup: this.lookup,
          signal,
          timeout: idleTimeoutMs,
          maxHeaderSize: MAX_HEADER_BYTES,
        },
        (response) => {
          responded = true;
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: readBody(response, () => idleTimedOut),
            destroy: () => {
              response.destroy();
              request.destroy();
            },
          });
        },
      );

      request.on('timeout', () => {
        idleTimedOut = true;
        request.destroy();
      });
      request.on('error', (error) => {
        // Après la réponse, l'erreur remonte par la lecture du corps.
        if (responded) return;
        if (error instanceof UrlFetcherError) reject(error);
        else if (idleTimedOut) reject(new UrlFetchTimeoutError());
        else reject(new UrlFetchNetworkError());
      });
      request.end();
    });
  }
}

async function* readBody(
  response: http.IncomingMessage,
  idleTimedOut: () => boolean,
): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of response) {
      yield chunk as Uint8Array;
    }
  } catch {
    throw idleTimedOut()
      ? new UrlFetchTimeoutError()
      : new UrlFetchNetworkError();
  }
}
