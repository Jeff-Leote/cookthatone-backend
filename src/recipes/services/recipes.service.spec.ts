import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/services/prisma.service';
import { RecipesService } from './recipes.service';

describe('RecipesService', () => {
  let service: RecipesService;
  let prisma: {
    recipe: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const ownedRecipe = { id: 'recipe-1', userId: 'user-1', title: 'Tarte' };

  beforeEach(async () => {
    prisma = {
      recipe: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RecipesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<RecipesService>(RecipesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // T06: findAll() userId valide -> tableau de recettes
  it('lists the recipes of the given user', async () => {
    prisma.recipe.findMany.mockResolvedValue([ownedRecipe]);

    const result = await service.findAll('user-1', {});

    expect(result).toEqual([ownedRecipe]);
    expect(prisma.recipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  // T07: findAll() userId + search='carb' -> tableau filtre
  it('filters recipes by search', async () => {
    prisma.recipe.findMany.mockResolvedValue([ownedRecipe]);

    await service.findAll('user-1', { search: 'carb' });

    expect(prisma.recipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          title: { contains: 'carb', mode: 'insensitive' },
        },
      }),
    );
  });

  // T08: findOne() id inexistant -> NotFoundException (404)
  it('throws NotFoundException when the recipe does not exist', async () => {
    prisma.recipe.findUnique.mockResolvedValue(null);

    await expect(service.findOne('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // T09: findOne() id d'un autre user -> ForbiddenException (403)
  it('throws ForbiddenException when the recipe belongs to another user', async () => {
    prisma.recipe.findUnique.mockResolvedValue({
      ...ownedRecipe,
      userId: 'someone-else',
    });

    await expect(service.findOne('user-1', 'recipe-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // T10: create() dto complet avec ingr. + etapes -> recette creee
  it('creates a recipe with nested ingredients and steps', async () => {
    prisma.recipe.create.mockResolvedValue({
      ...ownedRecipe,
      recipeIngredients: [],
      steps: [],
    });

    const dto = {
      title: 'Tarte',
      ingredients: [
        { ingredientId: 'ingredient-1', quantity: 2, unit: 'PIECE' as const },
      ],
      steps: [{ stepOrder: 1, instruction: 'Melanger' }],
    };

    const result = await service.create('user-1', dto);

    expect(result).toEqual(
      expect.objectContaining({ id: 'recipe-1', title: 'Tarte' }),
    );
    expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
  });

  it('throws ForbiddenException on update() for a recipe owned by another user', async () => {
    prisma.recipe.findUnique.mockResolvedValue({
      ...ownedRecipe,
      userId: 'someone-else',
    });

    await expect(
      service.update('user-1', 'recipe-1', { title: 'Autre' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.recipe.update).not.toHaveBeenCalled();
  });

  it('deletes an owned recipe', async () => {
    prisma.recipe.findUnique.mockResolvedValue(ownedRecipe);
    prisma.recipe.delete.mockResolvedValue(ownedRecipe);

    await service.remove('user-1', 'recipe-1');

    expect(prisma.recipe.delete).toHaveBeenCalledWith({
      where: { id: 'recipe-1' },
    });
  });
});
