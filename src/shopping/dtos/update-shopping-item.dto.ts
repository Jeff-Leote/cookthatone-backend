import { IsBoolean } from 'class-validator';

export class UpdateShoppingItemDto {
  @IsBoolean({ message: "L'état coché doit être vrai ou faux" })
  checked: boolean;
}
