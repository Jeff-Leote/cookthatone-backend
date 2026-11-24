import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateIngredientDto } from '../../ingredients/dtos/create-ingredient.dto';
import { CreateRecipeDto } from './create-recipe.dto';
import { UpdateRecipeDto } from './update-recipe.dto';

describe('Majuscule initiale des titres et des noms (B#82)', () => {
  describe('CreateRecipeDto.title', () => {
    it('met une majuscule et normalise les espaces', async () => {
      const dto = plainToInstance(CreateRecipeDto, {
        title: '  crêpes   maison ',
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.title).toBe('Crêpes maison');
    });

    it('retire le balisage avant la majuscule', () => {
      const dto = plainToInstance(CreateRecipeDto, { title: '<b>tarte</b>' });
      expect(dto.title).toBe('Tarte');
    });

    it('ne touche pas à la description', () => {
      const dto = plainToInstance(CreateRecipeDto, {
        title: 'tarte',
        description: 'une tarte  maison',
      });
      expect(dto.description).toBe('une tarte  maison');
    });

    it.each(['', '   '])(
      'refuse le titre %j avec le message existant',
      async (title) => {
        const errors = await validate(
          plainToInstance(CreateRecipeDto, { title }),
        );
        expect(errors).toHaveLength(1);
        expect(errors[0].constraints).toEqual({
          isNotEmpty: 'Le titre est requis',
        });
      },
    );

    it('refuse un titre qui n’est pas une chaîne', async () => {
      const errors = await validate(
        plainToInstance(CreateRecipeDto, { title: 12 }),
      );
      expect(errors[0].constraints).toEqual({
        isString: 'Le titre doit être une chaîne de caractères',
      });
    });
  });

  describe('UpdateRecipeDto.title', () => {
    it('met une majuscule à la modification', async () => {
      const dto = plainToInstance(UpdateRecipeDto, { title: ' œufs cocotte ' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.title).toBe('Œufs cocotte');
    });

    it('laisse le titre absent absent', async () => {
      const dto = plainToInstance(UpdateRecipeDto, {});
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.title).toBeUndefined();
    });

    it('refuse un titre d’espaces avec le message existant', async () => {
      const errors = await validate(
        plainToInstance(UpdateRecipeDto, { title: '   ' }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toEqual({
        isNotEmpty: 'Le titre ne peut pas être vide',
      });
    });
  });

  describe('CreateIngredientDto.name', () => {
    const build = (name: unknown) =>
      plainToInstance(CreateIngredientDto, { name, defaultUnit: 'G' });

    it('met une majuscule et normalise les espaces', async () => {
      const dto = build('  farine   de blé ');
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.name).toBe('Farine de blé');
    });

    it('retire le balisage avant la majuscule', () => {
      expect(build('<b>ail</b>').name).toBe('Ail');
    });

    it('refuse un nom vide avec le message existant', async () => {
      const errors = await validate(build('   '));
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toEqual({
        isNotEmpty: 'Le nom est requis',
      });
    });
  });
});
