import * as dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import {
  UrlFetchNetworkError,
  UrlNotAllowedError,
} from '../errors/url-fetcher.errors';
import { isForbiddenIp } from './ip-guard';

export type DnsResolver = (
  hostname: string,
  options: dns.LookupAllOptions,
) => Promise<dns.LookupAddress[]>;

const systemResolver: DnsResolver = (hostname, options) =>
  dns.promises.lookup(hostname, options);

/**
 * `lookup` à passer à `http(s).request` : l'adresse est validée au moment de la
 * connexion, puis Node se connecte à l'adresse déjà validée (pas de seconde
 * résolution). Une seule adresse interdite suffit à refuser le nom.
 */
export function createSafeLookup(
  resolver: DnsResolver = systemResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname, {
      all: true,
      family: options.family,
      hints: options.hints,
    }).then(
      (addresses) => {
        const deliver = (): void => {
          if (addresses.length === 0) {
            callback(new UrlFetchNetworkError(), '', 0);
            return;
          }
          if (addresses.some(({ address }) => isForbiddenIp(address))) {
            callback(new UrlNotAllowedError(), '', 0);
            return;
          }
          // Selon la version de Node, `all: true` est demandé et un tableau est attendu.
          if (options.all) {
            callback(null, addresses);
            return;
          }
          callback(null, addresses[0].address, addresses[0].family);
        };
        try {
          deliver();
        } catch {
          // Une exception du rappel ne doit pas devenir un rejet non géré (qui arrête
          // le processus) ni provoquer un second appel : le rappel est appelé une fois.
        }
      },
      () => callback(new UrlFetchNetworkError(), '', 0),
    );
  };
}
