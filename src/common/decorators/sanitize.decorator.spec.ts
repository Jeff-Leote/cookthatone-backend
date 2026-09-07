import { plainToInstance } from 'class-transformer';
import { Sanitize } from './sanitize.decorator';

class Dto {
  @Sanitize()
  value: string;
}

describe('Sanitize', () => {
  it('strips script tags from the value', () => {
    const dto = plainToInstance(Dto, {
      value: '<script>alert(1)</script>Ma recette',
    });
    expect(dto.value).toBe('Ma recette');
  });

  it('strips arbitrary HTML tags and attributes', () => {
    const dto = plainToInstance(Dto, {
      value: '<img src=x onerror=alert(1)>Titre',
    });
    expect(dto.value).toBe('Titre');
  });

  it('leaves plain text untouched', () => {
    const dto = plainToInstance(Dto, { value: 'Gâteau au chocolat' });
    expect(dto.value).toBe('Gâteau au chocolat');
  });

  it('leaves non-string values untouched', () => {
    class NumDto {
      @Sanitize()
      value: number;
    }
    const dto = plainToInstance(NumDto, { value: 42 });
    expect(dto.value).toBe(42);
  });
});
