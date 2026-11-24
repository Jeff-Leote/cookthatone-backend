import { Transform } from 'class-transformer';
import { capitalizeFirst } from '../capitalize';

// À écrire SOUS @Sanitize() : class-transformer exécute les @Transform d'une
// propriété du plus bas au plus haut, donc la majuscule s'applique une fois le
// balisage retiré. Une valeur qui n'est pas une chaîne est laissée à la
// validation.
export function Capitalize(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? capitalizeFirst(value) : value,
  );
}
