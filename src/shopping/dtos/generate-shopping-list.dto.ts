import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class GenerateShoppingListDto {
  @Type(() => Date)
  @IsDate()
  weekStart: Date;
}
