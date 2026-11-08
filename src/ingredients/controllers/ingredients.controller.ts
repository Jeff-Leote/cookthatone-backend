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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { IngredientsService } from '../services/ingredients.service';
import { CreateIngredientDto } from '../dtos/create-ingredient.dto';
import { UpdateIngredientDto } from '../dtos/update-ingredient.dto';

@ApiTags('ingredients')
@ApiBearerAuth()
@Controller('ingredients')
@UseGuards(JwtAuthGuard)
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.ingredientsService.findAll(req.user.userId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateIngredientDto) {
    return this.ingredientsService.create(req.user.userId, dto);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateIngredientDto,
  ) {
    return this.ingredientsService.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.ingredientsService.remove(req.user.userId, id);
  }
}
