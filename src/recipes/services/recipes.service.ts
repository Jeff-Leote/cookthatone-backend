import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { RedisService } from '../../redis/services/redis.service';
import { CreateRecipeDto } from '../dtos/create-recipe.dto';
import { UpdateRecipeDto } from '../dtos/update-recipe.dto';
import { RecipeIngredientDto } from '../dtos/recipe-ingredient.dto';
import { ReplaceRecipeStepsDto } from '../dtos/replace-recipe-steps.dto';
import { FindRecipesQueryDto } from '../dtos/find-recipes-query.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';
const RECIPE_LIST_CACHE_TTL_SECONDS = 30;

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAll(userId: string, query: FindRecipesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const cacheKey = `recipes:${userId}:${query.search ?? ''}:${page}:${limit}`;

    const cached = await this.redis.getJson<Prisma.RecipeGetPayload<object>[]>(
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const recipes = await this.prisma.recipe.findMany({
      where: {
        userId,
        ...(query.search
          ? { title: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    await this.redis.setJson(cacheKey, recipes, RECIPE_LIST_CACHE_TTL_SECONDS);
    return recipes;
  }

  async findOne(userId: string, id: string) {
    const recipe = await this.prisma.recipe.findUnique({
      where: { id },
      include: {
        recipeIngredients: { include: { ingredient: true } },
        steps: { orderBy: { stepOrder: 'asc' } },
      },
    });
    if (!recipe) {
      throw new NotFoundException('Recipe not found');
    }
    if (recipe.userId !== userId) {
      throw new ForbiddenException();
    }
    return recipe;
  }

  create(userId: string, dto: CreateRecipeDto) {
    return this.prisma.recipe.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        prepTimeMin: dto.prepTimeMin,
        cookTimeMin: dto.cookTimeMin,
        servings: dto.servings,
        recipeIngredients: dto.ingredients?.length
          ? {
              create: dto.ingredients.map((ingredient) => ({
                ingredientId: ingredient.ingredientId,
                quantity: ingredient.quantity,
                unit: ingredient.unit,
              })),
            }
          : undefined,
        steps: dto.steps?.length
          ? {
              create: dto.steps.map((step) => ({
                stepOrder: step.stepOrder,
                instruction: step.instruction,
              })),
            }
          : undefined,
      },
      include: {
        recipeIngredients: { include: { ingredient: true } },
        steps: { orderBy: { stepOrder: 'asc' } },
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateRecipeDto) {
    await this.ensureOwnedRecipe(userId, id);
    return this.prisma.recipe.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnedRecipe(userId, id);
    await this.prisma.recipe.delete({ where: { id } });
  }

  async addIngredient(
    userId: string,
    recipeId: string,
    dto: RecipeIngredientDto,
  ) {
    await this.ensureOwnedRecipe(userId, recipeId);

    try {
      return await this.prisma.recipeIngredient.create({
        data: {
          recipeId,
          ingredientId: dto.ingredientId,
          quantity: dto.quantity,
          unit: dto.unit,
        },
        include: { ingredient: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Ingredient already added to this recipe');
      }
      throw error;
    }
  }

  async removeIngredient(
    userId: string,
    recipeId: string,
    ingredientId: string,
  ) {
    await this.ensureOwnedRecipe(userId, recipeId);

    try {
      await this.prisma.recipeIngredient.delete({
        where: { recipeId_ingredientId: { recipeId, ingredientId } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw new NotFoundException('Ingredient not found on this recipe');
      }
      throw error;
    }
  }

  async replaceSteps(
    userId: string,
    recipeId: string,
    dto: ReplaceRecipeStepsDto,
  ) {
    await this.ensureOwnedRecipe(userId, recipeId);

    await this.prisma.$transaction([
      this.prisma.recipeStep.deleteMany({ where: { recipeId } }),
      this.prisma.recipeStep.createMany({
        data: dto.steps.map((step) => ({
          recipeId,
          stepOrder: step.stepOrder,
          instruction: step.instruction,
        })),
      }),
    ]);

    return this.prisma.recipeStep.findMany({
      where: { recipeId },
      orderBy: { stepOrder: 'asc' },
    });
  }

  private async ensureOwnedRecipe(userId: string, id: string) {
    const recipe = await this.prisma.recipe.findUnique({ where: { id } });
    if (!recipe) {
      throw new NotFoundException('Recipe not found');
    }
    if (recipe.userId !== userId) {
      throw new ForbiddenException();
    }
    return recipe;
  }
}
