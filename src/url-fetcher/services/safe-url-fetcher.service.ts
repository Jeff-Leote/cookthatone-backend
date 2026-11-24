import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  UrlFetchNetworkError,
  UrlFetchStatusError,
  UrlFetchTimeoutError,
  UrlFetchTooLargeError,
  UrlFetcherError,
  UrlInvalidError,
  UrlNotAllowedError,
  UrlTooManyRedirectsError,
  UrlUnsupportedContentError,
} from '../errors/url-fetcher.errors';
import type {
  TransportResponse,
  UrlFetchTransport,
} from '../transport/url-fetch-transport';
import {
  ALLOWED_MEDIA_TYPES,
  IDLE_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  OUTGOING_HEADERS,
  TOTAL_TIMEOUT_MS,
  URL_FETCH_TRANSPORT,
} from '../url-fetcher.constants';
import { decodeBody, parseContentType } from '../utils/content';
import { parseAllowedUrl } from '../utils/url-policy';

export interface FetchedPage {
  finalUrl: string;
  /** Type de média seul, en minuscules (sans paramètres). */
  contentType: string;
  html: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

@Injectable()
export class SafeUrlFetcherService {
  private readonly logger = new Logger(SafeUrlFetcherService.name);

  constructor(
    @Inject(URL_FETCH_TRANSPORT) private readonly transport: UrlFetchTransport,
  ) {}

  /**
   * Télécharge une page HTML publique.
   * @throws UrlFetcherError (ou l'une de ses sous-classes) pour tout refus ou échec.
   */
  async fetch(rawUrl: string): Promise<FetchedPage> {
    const controller = new AbortController();
    const state = { host: '' };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new UrlFetchTimeoutError());
      }, TOTAL_TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        this.run(rawUrl, controller.signal, state),
        deadline,
      ]);
    } catch (error) {
      const normalized = this.normalizeError(error, controller.signal);
      // Jamais l'URL complète dans les journaux : elle peut contenir un jeton.
      this.logger.warn(
        `Récupération échouée (${normalized.name})${state.host ? ` pour l'hôte ${state.host}` : ''}`,
      );
      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeError(error: unknown, signal: AbortSignal): UrlFetcherError {
    if (signal.aborted) return new UrlFetchTimeoutError();
    if (error instanceof UrlFetcherError) return error;
    return new UrlFetchNetworkError();
  }

  private async run(
    rawUrl: string,
    signal: AbortSignal,
    state: { host: string },
  ): Promise<FetchedPage> {
    let current = parseAllowedUrl(rawUrl);

    for (let redirects = 0; ; redirects++) {
      state.host = current.hostname;
      const response = await this.transport.request({
        url: current,
        headers: OUTGOING_HEADERS,
        signal,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      });

      try {
        if (REDIRECT_STATUSES.has(response.statusCode)) {
          if (redirects >= MAX_REDIRECTS) throw new UrlTooManyRedirectsError();
          current = this.nextUrl(response, current);
          continue;
        }
        return await this.readPage(response, current);
      } finally {
        response.destroy();
      }
    }
  }

  /** Résout `Location` par rapport à l'URL courante, puis revalide tout. */
  private nextUrl(response: TransportResponse, current: URL): URL {
    const location = response.headers.location;
    if (!location) throw new UrlFetchStatusError();
    let target: URL;
    try {
      target = new URL(location, current);
    } catch {
      throw new UrlInvalidError();
    }
    const next = parseAllowedUrl(target);
    // Le contenu reçu en clair pourrait être modifié en chemin : pas de https vers http.
    if (current.protocol === 'https:' && next.protocol === 'http:') {
      throw new UrlNotAllowedError();
    }
    return next;
  }

  private async readPage(
    response: TransportResponse,
    url: URL,
  ): Promise<FetchedPage> {
    if (response.statusCode < 200 || response.statusCode > 299) {
      throw new UrlFetchStatusError();
    }

    const { mediaType, charset } = parseContentType(
      response.headers['content-type'],
    );
    if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      throw new UrlUnsupportedContentError();
    }

    // Aucune décompression : un corps encodé est refusé (pas de bombe de décompression).
    const encoding = response.headers['content-encoding'];
    if (encoding && encoding.trim().toLowerCase() !== 'identity') {
      throw new UrlUnsupportedContentError();
    }

    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new UrlFetchTooLargeError();
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    // Le Content-Length peut mentir : la taille est recomptée pendant la lecture.
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > MAX_BODY_BYTES) {
        response.destroy();
        throw new UrlFetchTooLargeError();
      }
      chunks.push(chunk);
    }

    return {
      finalUrl: url.href,
      contentType: mediaType,
      html: decodeBody(Buffer.concat(chunks), charset),
    };
  }
}
