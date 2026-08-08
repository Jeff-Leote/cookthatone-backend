import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class GenerateShoppingListDto {
  @Type(() => Date)
  @IsDate({ message: 'La date de début doit être une date valide' })
  periodStart: Date;

  @Type(() => Date)
  @IsDate({ message: 'La date de fin doit être une date valide' })
  periodEnd: Date;
}
