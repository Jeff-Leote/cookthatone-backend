import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { IngredientsService } from './ingredients.service';

describe('IngredientsService', () => {
  let service: IngredientsService;
  let prisma: {
    ingredient: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    recipeIngredient: { count: jest.Mock };
    shoppingItem: { count: jest.Mock };
    stock: {
      count: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const ownedIngredient = {
    id: 'ingredient-1',
    userId: 'user-1',
    name: 'Tomate',
    defaultUnit: Unit.PIECE,
  };

  beforeEach(async () => {
    prisma = {
      ingredient: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      recipeIngredient: { count: jest.fn().mockResolvedValue(0) },
      shoppingItem: { count: jest.fn().mockResolvedValue(0) },
      stock: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngredientsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<IngredientsService>(IngredientsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('lists the ingredients of the given user', async () => {
    prisma.ingredient.findMany.mockResolvedValue([ownedIngredient]);

    const result = await service.findAll('user-1');

    expect(result).toEqual([ownedIngredient]);
    expect(prisma.ingredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('creates a new ingredient', async () => {
    prisma.ingredient.create.mockResolvedValue(ownedIngredient);

    const result = await service.create('user-1', {
      name: 'Tomate',
      defaultUnit: Unit.PIECE,
    });

    expect(result).toEqual(ownedIngredient);
  });

  it('throws ConflictException when the ingredient name is already used by this user', async () => {
    prisma.ingredient.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(
      service.create('user-1', { name: 'Tomate', defaultUnit: Unit.PIECE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes an owned ingredient', async () => {
    prisma.ingredient.findUnique.mockResolvedValue(ownedIngredient);
    prisma.ingredient.delete.mockResolvedValue(ownedIngredient);

    await service.remove('user-1', 'ingredient-1');

    expect(prisma.ingredient.delete).toHaveBeenCalledWith({
      where: { id: 'ingredient-1' },
    });
  });

  it('throws NotFoundException when the ingredient does not belong to the user', async () => {
    prisma.ingredient.findUnique.mockResolvedValue({
      ...ownedIngredient,
      userId: 'someone-else',
    });

    await expect(
      service.remove('user-1', 'ingredient-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ingredient.delete).not.toHaveBeenCalled();
  });

  it('throws ConflictException when the ingredient is still referenced (onDelete: Restrict)', async () => {
    prisma.ingredient.findUnique.mockResolvedValue(ownedIngredient);
    prisma.ingredient.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        {
          code: 'P2003',
          clientVersion: '7.8.0',
        },
      ),
    );

    await expect(
      service.remove('user-1', 'ingredient-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // L'unité d'un ingrédient est modifiable : même famille = stock converti.
  describe('update()', () => {
    it('changes the unit within the same family and converts the stock', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
      });
      prisma.stock.findMany.mockResolvedValue([
        { id: 'stock-1', quantity: 1500, unit: Unit.G },
      ]);
      prisma.ingredient.update.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.KG,
      });

      const result = await service.update('user-1', 'ingredient-1', {
        defaultUnit: Unit.KG,
      });

      expect(result.defaultUnit).toBe(Unit.KG);
      expect(prisma.stock.update).toHaveBeenCalledWith({
        where: { id: 'stock-1' },
        data: { quantity: 1.5, unit: Unit.KG },
      });
      expect(prisma.ingredient.update).toHaveBeenCalledWith({
        where: { id: 'ingredient-1' },
        data: { defaultUnit: Unit.KG },
      });
      expect(prisma.recipeIngredient.count).not.toHaveBeenCalled();
    });

    it('removes a stock line that rounds down to zero after conversion', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
      });
      prisma.stock.findMany.mockResolvedValue([
        { id: 'stock-1', quantity: 0.0004, unit: Unit.G },
      ]);
      prisma.ingredient.update.mockResolvedValue({});

      await service.update('user-1', 'ingredient-1', { defaultUnit: Unit.KG });

      expect(prisma.stock.delete).toHaveBeenCalledWith({
        where: { id: 'stock-1' },
      });
      expect(prisma.stock.update).not.toHaveBeenCalled();
    });

    it('refuses a change of family while the ingredient is used', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
      });
      prisma.recipeIngredient.count.mockResolvedValue(2);
      prisma.stock.count.mockResolvedValue(1);

      await expect(
        service.update('user-1', 'ingredient-1', { defaultUnit: Unit.ML }),
      ).rejects.toThrow('il est utilisé (2 ligne(s) de recette, le stock)');
      expect(prisma.ingredient.update).not.toHaveBeenCalled();
    });

    it('allows a change of family when the ingredient is not used', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
      });
      prisma.ingredient.update.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.ML,
      });

      const result = await service.update('user-1', 'ingredient-1', {
        defaultUnit: Unit.ML,
      });

      expect(result.defaultUnit).toBe(Unit.ML);
    });

    it('returns the ingredient untouched when the unit does not change', async () => {
      prisma.ingredient.findUnique.mockResolvedValue(ownedIngredient);

      const result = await service.update('user-1', 'ingredient-1', {
        defaultUnit: ownedIngredient.defaultUnit,
      });

      expect(result).toEqual(ownedIngredient);
      expect(prisma.ingredient.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an ingredient of another user', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        userId: 'someone-else',
      });

      await expect(
        service.update('user-1', 'ingredient-1', { defaultUnit: Unit.KG }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ingredient.update).not.toHaveBeenCalled();
    });
  });
  describe('update() avec une équivalence', () => {
    it('converts the stock between weight and volume when the equivalence exists', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
        gramsPerTablespoon: 10,
      });
      prisma.stock.findMany.mockResolvedValue([
        { id: 'stock-1', quantity: 1000, unit: Unit.G },
      ]);
      prisma.ingredient.update.mockResolvedValue({});

      await service.update('user-1', 'ingredient-1', { defaultUnit: Unit.ML });

      // 10 g pour 15 ml : 1000 g = 1500 ml
      expect(prisma.stock.update).toHaveBeenCalledWith({
        where: { id: 'stock-1' },
        data: { quantity: 1500, unit: Unit.ML },
      });
      expect(prisma.recipeIngredient.count).not.toHaveBeenCalled();
    });

    it('sets the equivalence and the unit together to allow a change of family', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
        gramsPerTablespoon: null,
      });
      prisma.recipeIngredient.count.mockResolvedValue(3);
      prisma.ingredient.update.mockResolvedValue({});

      await service.update('user-1', 'ingredient-1', {
        defaultUnit: Unit.ML,
        gramsPerTablespoon: 10,
      });

      expect(prisma.ingredient.update).toHaveBeenCalledWith({
        where: { id: 'ingredient-1' },
        data: { defaultUnit: Unit.ML, gramsPerTablespoon: 10 },
      });
    });

    it('only updates the equivalence when the unit does not change', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
        gramsPerTablespoon: null,
      });
      prisma.ingredient.update.mockResolvedValue({});

      await service.update('user-1', 'ingredient-1', {
        gramsPerTablespoon: 12,
      });

      expect(prisma.ingredient.update).toHaveBeenCalledWith({
        where: { id: 'ingredient-1' },
        data: { gramsPerTablespoon: 12 },
      });
      expect(prisma.stock.findMany).not.toHaveBeenCalled();
    });

    it('suggests the equivalence when a weight to volume change is refused', async () => {
      prisma.ingredient.findUnique.mockResolvedValue({
        ...ownedIngredient,
        defaultUnit: Unit.G,
        gramsPerTablespoon: null,
      });
      prisma.recipeIngredient.count.mockResolvedValue(1);

      await expect(
        service.update('user-1', 'ingredient-1', { defaultUnit: Unit.ML }),
      ).rejects.toThrow("Renseigne d'abord l'équivalence");
    });
  });
});
