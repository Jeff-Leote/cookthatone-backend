import type { IncomingHttpHeaders } from 'node:http';

export interface TransportRequest {
  url: URL;
  headers: Readonly<Record<string, string>>;
  /** Annulée quand le délai total est dépassé : le transport doit détruire la requête. */
  signal: AbortSignal;
  idleTimeoutMs: number;
}

export interface TransportResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  /** Ferme la connexion sans lire la suite du corps. */
  destroy(): void;
}

/**
 * Ouvre une connexion et renvoie la réponse. L'implémentation de production
 * contrôle l'adresse à la connexion ; les tests injectent un transport factice.
 */
export interface UrlFetchTransport {
  request(request: TransportRequest): Promise<TransportResponse>;
}
