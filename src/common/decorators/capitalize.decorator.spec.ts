import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, validate } from 'class-validator';
import { Capitalize } from './capitalize.decorator';
import { Sanitize } from './sanitize.decorator';

class Dto {
  @Sanitize()
  @Capitalize()
  @IsString({ message: 'Le texte doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le texte est requis' })
  value: string;
}

// Ordre inverse : prouve que l'ordre d'écriture compte.
class ReversedDto {
  @Capitalize()
  @Sanitize()
  value: string;
}

describe('Capitalize', () => {
  it('met la première lettre en majuscule et normalise les espaces', () => {
    const dto = plainToInstance(Dto, { value: '  crêpes   maison ' });
    expect(dto.value).toBe('Crêpes maison');
  });

  it('transforme « œufs » en « Œufs » et laisse « 3 chocolats » inchangé', () => {
    expect(plainToInstance(Dto, { value: 'œufs' }).value).toBe('Œufs');
    expect(plainToInstance(Dto, { value: '3 chocolats' }).value).toBe(
      '3 chocolats',
    );
  });

  it('s’applique après @Sanitize() écrit au-dessus : le balisage est retiré avant', () => {
    expect(plainToInstance(Dto, { value: '<b>ail</b>' }).value).toBe('Ail');
    expect(plainToInstance(Dto, { value: ' <i> ail </i> ' }).value).toBe('Ail');
  });

  it('s’exécute avant @Sanitize() si on l’écrit au-dessus', () => {
    // class-transformer exécute le @Transform le plus bas en premier : écrite
    // au-dessus, la majuscule serait appliquée à « <b> » avant le nettoyage.
    expect(plainToInstance(ReversedDto, { value: '<b>ail</b>' }).value).toBe(
      'ail',
    );
  });

  it('laisse une valeur qui n’est pas une chaîne à la validation', async () => {
    const dto = plainToInstance(Dto, { value: 42 });
    expect(dto.value).toBe(42);
    const errors = await validate(dto);
    expect(errors[0].constraints).toEqual({
      isString: 'Le texte doit être une chaîne de caractères',
    });
  });

  it('refuse une chaîne vide ou d’espaces avec un seul message', async () => {
    for (const value of ['', '   ', '<b> </b>']) {
      const errors = await validate(plainToInstance(Dto, { value }));
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toEqual({
        isNotEmpty: 'Le texte est requis',
      });
    }
  });
});
