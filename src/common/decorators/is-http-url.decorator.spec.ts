import { plainToInstance } from 'class-transformer';
import { IsOptional, validate } from 'class-validator';
import {
  HTTP_URL_MAX_LENGTH,
  HTTP_URL_MESSAGE,
  httpUrlMessage,
  IsHttpUrl,
} from './is-http-url.decorator';

class Dto {
  @IsHttpUrl()
  url: unknown;
}

class OptionalDto {
  @IsOptional()
  @IsHttpUrl()
  url?: unknown;
}

async function errorsFor(value: unknown) {
  return validate(plainToInstance(Dto, { url: value }));
}

describe('IsHttpUrl', () => {
  it.each([
    'https://exemple.fr/recette',
    'http://exemple.fr/a?b=1&c=2#x',
    'HTTPS://Exemple.fr:8080/chemin/é',
    'HTTP://exemple.fr',
    'Http://exemple.fr',
    // Une apostrophe est légitime dans un chemin de recette.
    "https://exemple.fr/recettes/l'agneau-roti",
    // « @ » et « %40 » restent permis après l'hôte (chemin, requête, fragment).
    'https://exemple.fr/@chef?mail=a%40b.fr#x@y',
  ])('accepts %s', async (url) => {
    expect(await errorsFor(url)).toHaveLength(0);
  });

  it.each([
    // Schémas autres que http(s) et formes sans schéma.
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['data:text/html,x'],
    ['file:///etc/passwd'],
    ['ftp://exemple.fr'],
    ['exemple.fr'],
    ['//exemple.fr/recette'],
    // Formes que `new URL()` accepte mais qui ne sont pas des adresses absolues.
    ['https:exemple.fr'],
    ['http:evil.fr'],
    ['https:/\\evil.fr'],
    ['https:\\evil.fr'],
    // Sans hôte.
    ['https://'],
    ['https:///x'],
    ['https://?x'],
    // Identifiants.
    ['https://user:pass@exemple.fr'],
    ['https://user@exemple.fr'],
    ['https://@exemple.fr'],
    ['https://exemple.fr\\@autre.fr'],
    ['https://exemple.fr\\autre.fr'],
    // « %40 » dans l'hôte : `new URL()` refuse le « % » dans un nom d'hôte.
    ['https://exemple.fr%40evil.fr'],
    ['https://a%40b.fr/'],
    // Caractères de contrôle et espaces internes.
    ['https://exemple.fr/a\u0000b'],
    ['https://exemple.fr/a b'],
    ['https://exemple.fr/a\nb'],
    ['https://exemple.fr/a\tb'],
    ['https://exemple.fr/a\u007fb'],
    [''],
    ['   '],
  ])('rejects %j', async (url) => {
    expect(await errorsFor(url)).toHaveLength(1);
  });

  it.each([
    ['« < »', 'https://exemple.fr/a<b'],
    ['« > »', 'https://exemple.fr/a>b'],
    ['« " »', 'https://exemple.fr/a"b'],
    ['une balise', 'https://exemple.fr/<script>x</script>'],
    ['U+200B (espace de largeur nulle)', 'https://exemple.fr/a\u200bb'],
    ['U+200B dans l’hôte', 'https://exem\u200bple.fr/'],
    ['U+200C', 'https://exemple.fr/a\u200cb'],
    ['U+200D', 'https://exemple.fr/a\u200db'],
    ['U+2060 (joint de mots)', 'https://exemple.fr/a\u2060b'],
    ['U+FEFF (BOM) à l’intérieur', 'https://exemple.fr/a\ufeffb'],
    ['U+202E (inversion du texte)', 'https://exemple.fr/a\u202eb'],
    ['U+202A', 'https://exemple.fr/a\u202ab'],
    ['U+2066 (isolat de direction)', 'https://exemple.fr/a\u2066b'],
    ['U+2069', 'https://exemple.fr/a\u2069b'],
    ['U+0080 (contrôle C1)', 'https://exemple.fr/a\u0080b'],
    ['U+0085 (contrôle C1)', 'https://exemple.fr/a\u0085b'],
    ['U+009F (contrôle C1)', 'https://exemple.fr/a\u009fb'],
    ['U+007F (DEL)', 'https://exemple.fr/a\u007fb'],
    // `trim()` ne retire pas U+200B : refusé même en tête ou en fin.
    ['U+200B en tête', '\u200bhttps://exemple.fr/'],
    ['U+200B en fin', 'https://exemple.fr/\u200b'],
  ])('rejects %s', async (_famille, url) => {
    expect(await errorsFor(url)).toHaveLength(1);
  });

  it('rejects a number, an object, a boolean, an array of strings and null', async () => {
    for (const value of [
      42,
      { href: 'https://exemple.fr' },
      true,
      ['https://exemple.fr'],
      null,
    ]) {
      expect(await errorsFor(value)).toHaveLength(1);
    }
  });

  it('accepts exactly the maximum length and rejects one more character', async () => {
    const prefix = 'https://exemple.fr/';
    const atLimit = prefix + 'a'.repeat(HTTP_URL_MAX_LENGTH - prefix.length);
    expect(atLimit).toHaveLength(HTTP_URL_MAX_LENGTH);
    expect(await errorsFor(atLimit)).toHaveLength(0);
    expect(await errorsFor(`${atLimit}a`)).toHaveLength(1);
  });

  it('trims leading and trailing whitespace and keeps the URL as typed', () => {
    const dto = plainToInstance(Dto, {
      url: '  http://exemple.fr/a?b=1&c=2#x \n',
    });
    // Ni normalisation (pas de « / » ajouté) ni échappement du « & ».
    expect(dto.url).toBe('http://exemple.fr/a?b=1&c=2#x');
  });

  it('trims no-break spaces and a BOM at either end, then accepts the address', async () => {
    for (const edge of ['\u00a0', '\ufeff', '\u2003', '\u2028']) {
      const dto = plainToInstance(Dto, {
        url: `${edge}https://exemple.fr/a?b=1&c=2${edge}`,
      });
      expect(dto.url).toBe('https://exemple.fr/a?b=1&c=2');
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('does not alter an accepted value (no normalisation, no escaping)', () => {
    const typed = "HTTP://Exemple.fr/l'agneau?a=1&b=%40#x";
    expect(plainToInstance(Dto, { url: typed }).url).toBe(typed);
  });

  it('leaves non-string values untouched by the transformation', () => {
    expect(plainToInstance(Dto, { url: 42 }).url).toBe(42);
  });

  it('reports the shared French message', async () => {
    const [error] = await errorsFor('javascript:alert(1)');
    expect(error.constraints?.isHttpUrl).toBe(HTTP_URL_MESSAGE);
    expect(HTTP_URL_MESSAGE).toBe(
      "L'adresse doit être une URL http ou https valide, sans identifiants (2048 caractères au plus)",
    );
    expect(httpUrlMessage("L'adresse de la source")).toBe(
      "L'adresse de la source doit être une URL http ou https valide, sans identifiants (2048 caractères au plus)",
    );
  });

  it('uses the same message for the hardened refusals', async () => {
    for (const url of ['https://exemple.fr/a<b', 'https:///x']) {
      const [error] = await errorsFor(url);
      expect(Object.values(error.constraints ?? {})).toEqual([
        HTTP_URL_MESSAGE,
      ]);
    }
  });

  it('lets @IsOptional() skip null and undefined', async () => {
    expect(
      await validate(plainToInstance(OptionalDto, { url: null })),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(OptionalDto, {}))).toHaveLength(0);
  });
});
