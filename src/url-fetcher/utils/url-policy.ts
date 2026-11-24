import { isIP } from 'node:net';
import {
  UrlInvalidError,
  UrlNotAllowedError,
} from '../errors/url-fetcher.errors';
import { MAX_URL_LENGTH } from '../url-fetcher.constants';
import { isForbiddenIp, stripBrackets } from './ip-guard';

/**
 * Valide une URL avant toute connexion et retourne sa forme normalisée.
 * `new URL()` convertit déjà les formes décimale, octale et hexadécimale d'une IPv4.
 */
export function parseAllowedUrl(input: string | URL): URL {
  const raw = typeof input === 'string' ? input.trim() : input.href;
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new UrlInvalidError();
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlInvalidError();
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlNotAllowedError();
  }
  if (url.username !== '' || url.password !== '') {
    throw new UrlNotAllowedError();
  }
  // `new URL()` retire le port par défaut du schéma (80 en http, 443 en https) :
  // tout port encore présent est donc non standard.
  if (url.port !== '') {
    throw new UrlNotAllowedError();
  }

  const host = stripBrackets(url.hostname).replace(/\.+$/, '');
  if (host === '') {
    throw new UrlInvalidError();
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UrlNotAllowedError();
  }
  if (isIP(host) !== 0 && isForbiddenIp(host)) {
    throw new UrlNotAllowedError();
  }
  return url;
}
