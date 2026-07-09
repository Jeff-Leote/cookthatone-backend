import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { ShoppingService } from '../services/shopping.service';
import { GenerateShoppingListDto } from '../dtos/generate-shopping-list.dto';
import { UpdateShoppingItemDto } from '../dtos/update-shopping-item.dto';

@Controller('shopping')
@UseGuards(JwtAuthGuard)
export class ShoppingController {
  constructor(private readonly shoppingService: ShoppingService) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.shoppingService.findAll(req.user.userId);
  }

  @Post('generate')
  generate(
    @Req() req: AuthenticatedRequest,
    @Body() dto: GenerateShoppingListDto,
  ) {
    return this.shoppingService.generate(req.user.userId, dto);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.shoppingService.findOne(req.user.userId, id);
  }

  @Patch(':id/items/:iid')
  updateItem(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('iid') itemId: string,
    @Body() dto: UpdateShoppingItemDto,
  ) {
    return this.shoppingService.updateItemChecked(
      req.user.userId,
      id,
      itemId,
      dto,
    );
  }

  @Post(':id/validate')
  validate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.shoppingService.validate(req.user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.shoppingService.remove(req.user.userId, id);
  }
}
