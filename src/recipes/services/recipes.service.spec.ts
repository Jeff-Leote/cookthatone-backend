import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { RedisService } from '../../redis/services/redis.service';
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
    recipeIngredient: { create: jest.Mock };
    ingredient: { findMany: jest.Mock };
  };
  let redis: {
    getJson: jest.Mock;
    setJson: jest.Mock;
    deleteByPrefix: jest.Mock;
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
      recipeIngredient: { create: jest.fn() },
      ingredient: {
        // L'unité de l'ingrédient est définitive : les lignes de recette doivent
        // être dans une unité compatible.
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'ingredient-1', name: 'Oeuf', defaultUnit: Unit.PIECE },
          ]),
      },
    };
    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
      deleteByPrefix: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
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

  // Cache Redis : findAll() sert le résultat en cache sans requêter Prisma
  it('returns the cached result without querying Prisma on a cache hit', async () => {
    redis.getJson.mockResolvedValue([ownedRecipe]);

    const result = await service.findAll('user-1', {});

    expect(result).toEqual([ownedRecipe]);
    expect(prisma.recipe.findMany).not.toHaveBeenCalled();
  });

  // Cache Redis : findAll() écrit le résultat en cache après une requête réelle
  it('caches the result after querying Prisma on a cache miss', async () => {
    prisma.recipe.findMany.mockResolvedValue([ownedRecipe]);

    await service.findAll('user-1', { search: 'carb' });

    expect(redis.setJson).toHaveBeenCalledWith(
      'recipes:user-1:carb:1:20',
      [ownedRecipe],
      30,
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
    expect(redis.deleteByPrefix).toHaveBeenCalledWith('recipes:user-1:');
  });

  it('rejects a recipe line whose unit has no equivalent in the ingredient unit', async () => {
    await expect(
      service.create('user-1', {
        title: 'Tarte',
        ingredients: [
          {
            ingredientId: 'ingredient-1',
            quantity: 200,
            unit: Unit.G,
          },
        ],
      }),
    ).rejects.toThrow("L'unité g n'est pas compatible avec « Oeuf » (pièce)");
    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });

  it('rejects a recipe line that uses an ingredient of another user', async () => {
    prisma.ingredient.findMany.mockResolvedValue([]);

    await expect(
      service.create('user-1', {
        title: 'Tarte',
        ingredients: [
          { ingredientId: 'ingredient-9', quantity: 1, unit: Unit.PIECE },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });

  it('accepts a compatible unit different from the ingredient unit', async () => {
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-2', name: 'Lait', defaultUnit: Unit.ML },
    ]);
    prisma.recipe.create.mockResolvedValue({ ...ownedRecipe });

    await service.create('user-1', {
      title: 'Crêpes',
      ingredients: [
        {
          ingredientId: 'ingredient-2',
          quantity: 2,
          unit: Unit.CUILLERE_A_SOUPE,
        },
      ],
    });

    expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
  });

  it('checks the unit when adding an ingredient to an existing recipe', async () => {
    prisma.recipe.findUnique.mockResolvedValue(ownedRecipe);

    await expect(
      service.addIngredient('user-1', 'recipe-1', {
        ingredientId: 'ingredient-1',
        quantity: 3,
        unit: Unit.KG,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.recipeIngredient.create).not.toHaveBeenCalled();
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
    expect(redis.deleteByPrefix).toHaveBeenCalledWith('recipes:user-1:');
  });

  // Une écriture doit vider les listes en cache de cet utilisateur pour qu'elles
  // reflètent immédiatement la modification, sans attendre l'expiration du TTL.
  it('clears the user cached lists when updating a recipe', async () => {
    prisma.recipe.findUnique.mockResolvedValue(ownedRecipe);
    prisma.recipe.update.mockResolvedValue({ ...ownedRecipe, title: 'Autre' });

    await service.update('user-1', 'recipe-1', { title: 'Autre' });

    expect(redis.deleteByPrefix).toHaveBeenCalledWith('recipes:user-1:');
  });

  it('does not clear the cache when the recipe belongs to someone else', async () => {
    prisma.recipe.findUnique.mockResolvedValue({
      ...ownedRecipe,
      userId: 'someone-else',
    });

    await expect(service.remove('user-1', 'recipe-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(redis.deleteByPrefix).not.toHaveBeenCalled();
  });
  it('accepts spoons for a weight ingredient that has an equivalence', async () => {
    prisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ingredient-3',
        name: 'Farine',
        defaultUnit: Unit.G,
        gramsPerTablespoon: 10,
      },
    ]);
    prisma.recipe.create.mockResolvedValue({ ...ownedRecipe });

    await service.create('user-1', {
      title: 'Gâteau',
      ingredients: [
        {
          ingredientId: 'ingredient-3',
          quantity: 1,
          unit: Unit.CUILLERE_A_SOUPE,
        },
      ],
    });

    expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
  });

  it('accepts spoons for a weight ingredient without equivalence (universal fallback)', async () => {
    prisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ingredient-3',
        name: 'Farine',
        defaultUnit: Unit.G,
        gramsPerTablespoon: null,
      },
    ]);
    prisma.recipe.create.mockResolvedValue({ ...ownedRecipe });

    await service.create('user-1', {
      title: 'Gâteau',
      ingredients: [
        {
          ingredientId: 'ingredient-3',
          quantity: 1,
          unit: Unit.CUILLERE_A_CAFE,
        },
      ],
    });

    expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
  });

  it('asks for the equivalence when a volume other than a spoon is used for a weight ingredient without one', async () => {
    prisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ingredient-3',
        name: 'Farine',
        defaultUnit: Unit.G,
        gramsPerTablespoon: null,
      },
    ]);

    await expect(
      service.create('user-1', {
        title: 'Gâteau',
        ingredients: [
          {
            ingredientId: 'ingredient-3',
            quantity: 1,
            unit: Unit.CL,
          },
        ],
      }),
    ).rejects.toThrow("renseigne d'abord son équivalence");
  });

  it('refuse deux lignes du même ingrédient dans une recette (400)', async () => {
    prisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ingredient-3',
        name: 'Farine',
        defaultUnit: Unit.G,
        gramsPerTablespoon: 10,
      },
    ]);

    await expect(
      service.create('user-1', {
        title: 'Gâteau',
        ingredients: [
          { ingredientId: 'ingredient-3', quantity: 600, unit: Unit.G },
          {
            ingredientId: 'ingredient-3',
            quantity: 3,
            unit: Unit.CUILLERE_A_SOUPE,
          },
        ],
      }),
    ).rejects.toThrow('apparaît plusieurs fois dans la recette');
    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });
});
