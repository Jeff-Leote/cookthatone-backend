export interface ParsedContentType {
  mediaType: string;
  charset: string | null;
}

export function parseContentType(
  header: string | undefined,
): ParsedContentType {
  if (!header) return { mediaType: '', charset: null };
  const [media, ...params] = header.split(';');
  let charset: string | null = null;
  for (const param of params) {
    const separator = param.indexOf('=');
    if (separator === -1) continue;
    if (param.slice(0, separator).trim().toLowerCase() !== 'charset') continue;
    charset = param
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .toLowerCase();
  }
  return { mediaType: media.trim().toLowerCase(), charset: charset || null };
}

/** Décode en texte avec le charset annoncé ; un charset inconnu retombe sur UTF-8. */
export function decodeBody(bytes: Uint8Array, charset: string | null): string {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // charset inconnu : repli sur UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}
