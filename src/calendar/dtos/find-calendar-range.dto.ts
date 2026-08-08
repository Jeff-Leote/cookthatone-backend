import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class FindCalendarRangeDto {
  @Type(() => Date)
  @IsDate({ message: 'La date de début doit être une date valide' })
  from!: Date;

  @Type(() => Date)
  @IsDate({ message: 'La date de fin doit être une date valide' })
  to!: Date;
}
