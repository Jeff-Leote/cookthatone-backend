import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { ACCESS_DENIED_MESSAGE } from '../../common/messages';
import {
  areUnitsCompatible,
  incompatibleUnitMessage,
} from '../../common/units';
import { RedisService } from '../../redis/services/redis.service';
import { CreateRecipeDto } from '../dtos/create-recipe.dto';
import { UpdateRecipeDto } from '../dtos/update-recipe.dto';
import { RecipeIngredientDto } from '../dtos/recipe-ingredient.dto';
import { UpdateRecipeIngredientDto } from '../dtos/update-recipe-ingredient.dto';
import { ReplaceRecipeStepsDto } from '../dtos/replace-recipe-steps.dto';
import { FindRecipesQueryDto } from '../dtos/find-recipes-query.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';
const RECIPE_LIST_CACHE_TTL_SECONDS = 30;

function cachePrefix(userId: string): string {
  return `recipes:${userId}:`;
}

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAll(userId: string, query: FindRecipesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const cacheKey = `${cachePrefix(userId)}${query.search ?? ''}:${page}:${limit}`;

    const cached =
      await this.redis.getJson<Prisma.RecipeGetPayload<object>[]>(cacheKey);
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
      throw new NotFoundException('Recette introuvable');
    }
    if (recipe.userId !== userId) {
      throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
    }
    return recipe;
  }

  async create(userId: string, dto: CreateRecipeDto) {
    await this.assertIngredientUnits(userId, dto.ingredients ?? []);
    const recipe = await this.prisma.recipe.create({
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
    await this.redis.deleteByPrefix(cachePrefix(userId));
    return recipe;
  }

  async update(userId: string, id: string, dto: UpdateRecipeDto) {
    await this.ensureOwnedRecipe(userId, id);
    const recipe = await this.prisma.recipe.update({
      where: { id },
      data: dto,
    });
    await this.redis.deleteByPrefix(cachePrefix(userId));
    return recipe;
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnedRecipe(userId, id);
    await this.prisma.recipe.delete({ where: { id } });
    await this.redis.deleteByPrefix(cachePrefix(userId));
  }

  async addIngredient(
    userId: string,
    recipeId: string,
    dto: RecipeIngredientDto,
  ) {
    await this.ensureOwnedRecipe(userId, recipeId);
    await this.assertIngredientUnits(userId, [dto]);

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
        throw new ConflictException('Cet ingrédient est déjà dans la recette');
      }
      throw error;
    }
  }

  // Modifie la quantité et/ou l'unité d'une ligne existante, avec le même
  // contrôle d'unité que l'ajout : une unité sans équivalent est refusée et la
  // ligne reste intacte.
  async updateIngredient(
    userId: string,
    recipeId: string,
    ingredientId: string,
    dto: UpdateRecipeIngredientDto,
  ) {
    await this.ensureOwnedRecipe(userId, recipeId);
    const where = { recipeId_ingredientId: { recipeId, ingredientId } };
    const line = await this.prisma.recipeIngredient.findUnique({ where });
    if (!line) {
      throw new NotFoundException("Cet ingrédient n'est pas dans la recette");
    }

    const unit = dto.unit ?? line.unit;
    await this.assertIngredientUnits(userId, [{ ingredientId, unit }]);

    return this.prisma.recipeIngredient.update({
      where,
      data: { quantity: dto.quantity ?? line.quantity, unit },
      include: { ingredient: true },
    });
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
        throw new NotFoundException("Cet ingrédient n'est pas dans la recette");
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

  // Chaque ingrédient appartient à l'utilisateur et la ligne de recette est
  // dans une unité compatible avec l'unité (définitive) de l'ingrédient :
  // sinon les quantités de la recette et du stock ne seraient pas comparables.
  private async assertIngredientUnits(
    userId: string,
    lines: { ingredientId: string; unit: Unit }[],
  ) {
    if (lines.length === 0) return;
    const ids = [...new Set(lines.map((line) => line.ingredientId))];
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: ids }, userId },
    });
    const byId = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient]),
    );
    const seen = new Set<string>();
    for (const line of lines) {
      const ingredient = byId.get(line.ingredientId);
      if (!ingredient) {
        throw new NotFoundException('Ingrédient introuvable');
      }
      // Une ligne par ingrédient (contrainte unique en base) : sans ce contrôle,
      // un doublon finirait en erreur 500.
      if (seen.has(line.ingredientId)) {
        throw new BadRequestException(
          `« ${ingredient.name} » apparaît plusieurs fois dans la recette : regroupe les quantités sur une seule ligne`,
        );
      }
      seen.add(line.ingredientId);
      if (
        !areUnitsCompatible(
          line.unit,
          ingredient.defaultUnit,
          ingredient.gramsPerTablespoon,
        )
      ) {
        throw new BadRequestException(
          incompatibleUnitMessage(
            line.unit,
            ingredient.name,
            ingredient.defaultUnit,
          ),
        );
      }
    }
  }

  private async ensureOwnedRecipe(userId: string, id: string) {
    const recipe = await this.prisma.recipe.findUnique({ where: { id } });
    if (!recipe) {
      throw new NotFoundException('Recette introuvable');
    }
    if (recipe.userId !== userId) {
      throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
    }
    return recipe;
  }
}
