import {
  UrlInvalidError,
  UrlNotAllowedError,
} from '../errors/url-fetcher.errors';
import { parseAllowedUrl } from './url-policy';

describe('parseAllowedUrl', () => {
  it('accepte une URL http ou https publique', () => {
    expect(parseAllowedUrl('https://exemple.fr/recette?id=1').href).toBe(
      'https://exemple.fr/recette?id=1',
    );
    expect(parseAllowedUrl('http://exemple.fr/').protocol).toBe('http:');
  });

  it('accepte les ports standards explicites', () => {
    expect(parseAllowedUrl('http://exemple.fr:80/').href).toBe(
      'http://exemple.fr/',
    );
    expect(parseAllowedUrl('https://exemple.fr:443/').href).toBe(
      'https://exemple.fr/',
    );
  });

  it('accepte des adresses IP publiques littérales', () => {
    expect(() => parseAllowedUrl('http://93.184.216.34/')).not.toThrow();
    expect(() =>
      parseAllowedUrl('https://[2606:4700:4700::1111]/'),
    ).not.toThrow();
  });

  it.each([
    ['file:///etc/passwd'],
    ['ftp://exemple.fr/'],
    ['data:text/html,<p>x</p>'],
    ['javascript:alert(1)'],
    ['gopher://exemple.fr/'],
    ['ws://exemple.fr/'],
  ])('refuse le schéma : %s', (url) => {
    expect(() => parseAllowedUrl(url)).toThrow(UrlNotAllowedError);
  });

  it.each([
    ['https://user:pass@exemple.fr/'],
    ['https://user@exemple.fr/'],
    ['https://:pass@exemple.fr/'],
  ])("refuse les identifiants dans l'URL : %s", (url) => {
    expect(() => parseAllowedUrl(url)).toThrow(UrlNotAllowedError);
  });

  it.each([
    ['http://exemple.fr:8080/'],
    ['https://exemple.fr:8443/'],
    ['http://exemple.fr:443/'],
    ['https://exemple.fr:80/'],
    ['http://exemple.fr:22/'],
  ])('refuse un port non standard : %s', (url) => {
    expect(() => parseAllowedUrl(url)).toThrow(UrlNotAllowedError);
  });

  it.each([[''], ['   '], ['pas une url'], ['http://'], ['://exemple.fr']])(
    'refuse une URL vide ou invalide : "%s"',
    (url) => {
      expect(() => parseAllowedUrl(url)).toThrow(UrlInvalidError);
    },
  );

  it('refuse une URL trop longue', () => {
    expect(() =>
      parseAllowedUrl(`https://exemple.fr/${'a'.repeat(3000)}`),
    ).toThrow(UrlInvalidError);
  });

  it.each([
    ['http://localhost/'],
    ['http://LOCALHOST/'],
    ['http://localhost./'],
    ['http://app.localhost/'],
  ])("refuse l'hôte localhost : %s", (url) => {
    expect(() => parseAllowedUrl(url)).toThrow(UrlNotAllowedError);
  });

  it.each([
    ['http://127.0.0.1/'],
    ['http://127.0.0.1./'],
    ['http://2130706433/'],
    ['http://0x7f.1/'],
    ['http://0177.0.0.1/'],
    ['http://10.0.0.5/'],
    ['http://192.168.1.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[::ffff:7f00:1]/'],
    ['http://[fe80::1]/'],
    ['http://0.0.0.0/'],
  ])('refuse une adresse IP interdite : %s', (url) => {
    expect(() => parseAllowedUrl(url)).toThrow(UrlNotAllowedError);
  });

  it('accepte un objet URL déjà construit et le revalide', () => {
    expect(() =>
      parseAllowedUrl(new URL('https://exemple.fr/a')),
    ).not.toThrow();
    expect(() => parseAllowedUrl(new URL('http://10.0.0.1/'))).toThrow(
      UrlNotAllowedError,
    );
  });

  it('produit le même message pour toutes les adresses refusées', () => {
    const messages = [
      'http://127.0.0.1/',
      'http://localhost/',
      'ftp://exemple.fr/',
      'http://exemple.fr:8080/',
      'http://a:b@exemple.fr/',
    ].map((url) => {
      try {
        parseAllowedUrl(url);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(new Set(messages)).toEqual(new Set(['Adresse non autorisée']));
  });
});
