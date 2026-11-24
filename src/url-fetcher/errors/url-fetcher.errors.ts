/**
 * Erreurs typées du récupérateur d'URL. Les messages sont volontairement
 * génériques : aucun ne révèle une adresse résolue ni la raison précise d'un refus.
 */
export abstract class UrlFetcherError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** URL vide, illisible ou trop longue. */
export class UrlInvalidError extends UrlFetcherError {
  constructor() {
    super("Cette adresse n'est pas valide");
  }
}

/** Refus de la politique (schéma, identifiants, port, hôte ou adresse IP) : un seul message. */
export class UrlNotAllowedError extends UrlFetcherError {
  constructor() {
    super('Adresse non autorisée');
  }
}

export class UrlTooManyRedirectsError extends UrlFetcherError {
  constructor() {
    super('Trop de redirections');
  }
}

/** Échec de résolution, de connexion ou de lecture. */
export class UrlFetchNetworkError extends UrlFetcherError {
  constructor() {
    super('Impossible de récupérer la page');
  }
}

/** Le site distant a répondu avec un statut d'erreur (ou une redirection inexploitable). */
export class UrlFetchStatusError extends UrlFetcherError {
  constructor() {
    super("La page demandée n'est pas disponible");
  }
}

export class UrlFetchTimeoutError extends UrlFetcherError {
  constructor() {
    super('Le site a mis trop de temps à répondre');
  }
}

export class UrlFetchTooLargeError extends UrlFetcherError {
  constructor() {
    super('La page est trop volumineuse');
  }
}

/** Type de contenu ou encodage non pris en charge. */
export class UrlUnsupportedContentError extends UrlFetcherError {
  constructor() {
    super("Ce contenu n'est pas une page web exploitable");
  }
}
