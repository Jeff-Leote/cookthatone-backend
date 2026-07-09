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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { RecipesService } from '../services/recipes.service';
import { CreateRecipeDto } from '../dtos/create-recipe.dto';
import { UpdateRecipeDto } from '../dtos/update-recipe.dto';
import { RecipeIngredientDto } from '../dtos/recipe-ingredient.dto';
import { ReplaceRecipeStepsDto } from '../dtos/replace-recipe-steps.dto';
import { FindRecipesQueryDto } from '../dtos/find-recipes-query.dto';

@ApiTags('recipes')
@ApiBearerAuth()
@Controller('recipes')
@UseGuards(JwtAuthGuard)
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: FindRecipesQueryDto,
  ) {
    return this.recipesService.findAll(req.user.userId, query);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipesService.findOne(req.user.userId, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRecipeDto) {
    return this.recipesService.create(req.user.userId, dto);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
  ) {
    return this.recipesService.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipesService.remove(req.user.userId, id);
  }

  @Post(':id/ingredients')
  addIngredient(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RecipeIngredientDto,
  ) {
    return this.recipesService.addIngredient(req.user.userId, id, dto);
  }

  @Delete(':id/ingredients/:iid')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeIngredient(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('iid') ingredientId: string,
  ) {
    return this.recipesService.removeIngredient(
      req.user.userId,
      id,
      ingredientId,
    );
  }

  @Put(':id/steps')
  replaceSteps(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReplaceRecipeStepsDto,
  ) {
    return this.recipesService.replaceSteps(req.user.userId, id, dto);
  }
}
