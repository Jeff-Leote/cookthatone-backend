import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ValidateCalendarEntryDto {
  @IsBoolean()
  done: boolean;

  @IsOptional()
  @IsUUID()
  actualRecipeId?: string;
}
