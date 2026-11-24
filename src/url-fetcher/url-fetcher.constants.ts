export const URL_FETCH_TRANSPORT = Symbol('URL_FETCH_TRANSPORT');

export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_URL_LENGTH = 2048;
/** Délai total : résolution, connexion, redirections et lecture. */
export const TOTAL_TIMEOUT_MS = 8000;
/** Délai d'inactivité d'une socket. */
export const IDLE_TIMEOUT_MS = 5000;

export const ALLOWED_MEDIA_TYPES: readonly string[] = [
  'text/html',
  'application/xhtml+xml',
];

/** Seuls en-têtes envoyés : rien ne vient de l'utilisateur ni d'une réponse précédente. */
export const OUTGOING_HEADERS: Readonly<Record<string, string>> = Object.freeze(
  {
    'User-Agent': 'CookthatOne-RecipeImporter/1.0',
    Accept: 'text/html,application/xhtml+xml;q=0.9',
    'Accept-Encoding': 'identity',
  },
);
