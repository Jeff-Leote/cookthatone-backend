import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { httpUrlMessage } from '../../common/decorators/is-http-url.decorator';
import { CreateRecipeDto } from './create-recipe.dto';
import { UpdateRecipeDto } from './update-recipe.dto';

const SOURCE_URL_MESSAGE = httpUrlMessage("L'adresse de la source");

describe('sourceUrl des DTO de recette', () => {
  describe('CreateRecipeDto', () => {
    const build = (extra: Record<string, unknown>) =>
      plainToInstance(CreateRecipeDto, { title: 'Tarte', ...extra });

    it('accepts a recipe without sourceUrl', async () => {
      const dto = build({});
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.sourceUrl).toBeUndefined();
    });

    it('accepts an http(s) address and keeps it as typed after trimming', async () => {
      const dto = build({ sourceUrl: '  http://exemple.fr/a?b=1&c=2#x  ' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.sourceUrl).toBe('http://exemple.fr/a?b=1&c=2#x');
    });

    it.each(['HTTP://exemple.fr', 'Http://exemple.fr'])(
      'accepts %s and keeps its case',
      async (sourceUrl) => {
        const dto = build({ sourceUrl });
        expect(await validate(dto)).toHaveLength(0);
        expect(dto.sourceUrl).toBe(sourceUrl);
      },
    );

    it.each([
      'javascript:alert(1)',
      'data:text/html,x',
      'http:evil.fr',
      'https:///x',
      'https://exemple.fr/a<b',
      'https://exemple.fr/a\u200bb',
      'https://exemple.fr/a\u202eb',
      'https://exemple.fr/a\u0085b',
      ['https://exemple.fr'],
      'file:///etc/passwd',
      'ftp://exemple.fr',
      'exemple.fr',
      'https://user:pass@exemple.fr',
      '',
      '   ',
      `https://exemple.fr/${'a'.repeat(2048)}`,
    ])('rejects %j with a French message', async (sourceUrl) => {
      const [error] = await validate(build({ sourceUrl }));
      expect(error.property).toBe('sourceUrl');
      expect(Object.values(error.constraints ?? {})).toEqual([
        SOURCE_URL_MESSAGE,
      ]);
    });

    it('rejects a number, an object and null (null clears only on update)', async () => {
      for (const sourceUrl of [42, { href: 'https://exemple.fr' }, null]) {
        const errors = await validate(build({ sourceUrl }));
        expect(errors.map((e) => e.property)).toEqual(['sourceUrl']);
      }
    });
  });

  describe('UpdateRecipeDto', () => {
    const build = (body: Record<string, unknown>) =>
      plainToInstance(UpdateRecipeDto, body);

    it('leaves sourceUrl undefined when the field is not sent', async () => {
      const dto = build({ title: 'Autre' });
      expect(await validate(dto)).toHaveLength(0);
      // `undefined` : Prisma ignore le champ, la valeur en base reste inchangée.
      expect(dto.sourceUrl).toBeUndefined();
    });

    it('accepts null to clear the source', async () => {
      const dto = build({ sourceUrl: null });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.sourceUrl).toBeNull();
    });

    it('accepts a replacement address, trimmed and unaltered', async () => {
      const dto = build({ sourceUrl: ' https://exemple.fr/recette?a=1&b=2 ' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.sourceUrl).toBe('https://exemple.fr/recette?a=1&b=2');
    });

    it.each(['HTTP://exemple.fr', 'Http://exemple.fr'])(
      'accepts %s and keeps its case',
      async (sourceUrl) => {
        const dto = build({ sourceUrl });
        expect(await validate(dto)).toHaveLength(0);
        expect(dto.sourceUrl).toBe(sourceUrl);
      },
    );

    it.each([
      'javascript:alert(1)',
      'ftp://exemple.fr',
      'https:///x',
      'https://exemple.fr/a"b',
      'https://exemple.fr/a\u200bb',
      ['https://exemple.fr'],
      'exemple.fr',
      'https://user:pass@exemple.fr',
      '',
      '   ',
      42,
      { href: 'https://exemple.fr' },
    ])('rejects %j with a French message', async (sourceUrl) => {
      const [error] = await validate(build({ sourceUrl }));
      expect(error.property).toBe('sourceUrl');
      expect(Object.values(error.constraints ?? {})).toEqual([
        SOURCE_URL_MESSAGE,
      ]);
    });
  });
});
