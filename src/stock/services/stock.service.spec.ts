import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { StockService } from './stock.service';

describe('StockService', () => {
  let service: StockService;
  let prisma: {
    stock: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    ingredient: { findFirst: jest.Mock };
  };

  const ownedStock = {
    id: 'stock-1',
    userId: 'user-1',
    ingredientId: 'ingredient-1',
    quantity: 500,
    unit: Unit.G,
    expiresAt: null,
  };

  // L'unité de l'ingrédient est définitive : le stock y est toujours
  // enregistré.
  const flour = {
    id: 'ingredient-1',
    name: 'Farine',
    defaultUnit: Unit.G,
  };

  beforeEach(async () => {
    prisma = {
      stock: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      ingredient: {
        findFirst: jest.fn().mockResolvedValue(flour),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StockService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('lists the stock of the given user', async () => {
    prisma.stock.findMany.mockResolvedValue([ownedStock]);

    const result = await service.findAll('user-1', {});

    expect(result).toEqual([ownedStock]);
    expect(prisma.stock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('filters to items expiring soon', async () => {
    let capturedWhere: { expiresAt?: { not: null; lte: Date } } | undefined;
    prisma.stock.findMany.mockImplementation(
      (args: { where: { expiresAt?: { not: null; lte: Date } } }) => {
        capturedWhere = args.where;
        return Promise.resolve([ownedStock]);
      },
    );

    await service.findAll('user-1', { expiringSoon: true });

    expect(capturedWhere?.expiresAt?.not).toBeNull();
    expect(capturedWhere?.expiresAt?.lte).toBeInstanceOf(Date);
  });

  it('creates a new stock entry', async () => {
    prisma.stock.create.mockResolvedValue(ownedStock);

    const result = await service.create('user-1', {
      ingredientId: 'ingredient-1',
      quantity: 500,
      unit: Unit.G,
    });

    expect(result).toEqual(ownedStock);
    const [args] = prisma.stock.create.mock.calls[0] as [
      { data: { quantity: number; unit: Unit } },
    ];
    expect(args.data).toMatchObject({ quantity: 500, unit: Unit.G });
  });

  it('converts a compatible unit into the ingredient unit', async () => {
    prisma.stock.create.mockResolvedValue(ownedStock);

    await service.create('user-1', {
      ingredientId: 'ingredient-1',
      quantity: 1.5,
      unit: Unit.KG,
    });

    const [args] = prisma.stock.create.mock.calls[0] as [
      { data: { quantity: number; unit: Unit } },
    ];
    expect(args.data).toMatchObject({ quantity: 1500, unit: Unit.G });
  });

  it('rejects a unit without equivalent in the ingredient unit', async () => {
    await expect(
      service.create('user-1', {
        ingredientId: 'ingredient-1',
        quantity: 2,
        unit: Unit.ML,
      }),
    ).rejects.toThrow("L'unité ml n'est pas compatible avec « Farine » (g)");
    expect(prisma.stock.create).not.toHaveBeenCalled();
  });

  it('rejects an ingredient that does not belong to the user', async () => {
    prisma.ingredient.findFirst.mockResolvedValue(null);

    await expect(
      service.create('user-1', {
        ingredientId: 'ingredient-2',
        quantity: 1,
        unit: Unit.G,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.stock.create).not.toHaveBeenCalled();
  });

  it('rejects a quantity that rounds down to zero', async () => {
    await expect(
      service.create('user-1', {
        ingredientId: 'ingredient-1',
        quantity: 0.0000001,
        unit: Unit.KG,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws ConflictException when the ingredient is already in stock', async () => {
    prisma.stock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(
      service.create('user-1', {
        ingredientId: 'ingredient-1',
        quantity: 500,
        unit: Unit.G,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates an owned stock entry', async () => {
    prisma.stock.findUnique.mockResolvedValue(ownedStock);
    prisma.stock.update.mockResolvedValue({ ...ownedStock, quantity: 250 });

    const result = await service.update('user-1', 'stock-1', { quantity: 250 });

    expect(result.quantity).toBe(250);
  });

  it('throws ForbiddenException when updating a stock entry owned by another user', async () => {
    prisma.stock.findUnique.mockResolvedValue({
      ...ownedStock,
      userId: 'someone-else',
    });

    await expect(
      service.update('user-1', 'stock-1', { quantity: 250 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.stock.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when removing a missing stock entry', async () => {
    prisma.stock.findUnique.mockResolvedValue(null);

    await expect(service.remove('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removes an owned stock entry', async () => {
    prisma.stock.findUnique.mockResolvedValue(ownedStock);
    prisma.stock.delete.mockResolvedValue(ownedStock);

    await service.remove('user-1', 'stock-1');

    expect(prisma.stock.delete).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
    });
  });
  it('converts spoons into grams with the ingredient equivalence', async () => {
    prisma.ingredient.findFirst.mockResolvedValue({
      id: 'ingredient-1',
      name: 'Farine',
      defaultUnit: Unit.G,
      gramsPerTablespoon: 10,
    });
    prisma.stock.create.mockResolvedValue(ownedStock);

    await service.create('user-1', {
      ingredientId: 'ingredient-1',
      quantity: 2,
      unit: Unit.CUILLERE_A_SOUPE,
    });

    const [args] = prisma.stock.create.mock.calls[0] as [
      { data: { quantity: number; unit: Unit } },
    ];
    expect(args.data).toMatchObject({ quantity: 20, unit: Unit.G });
  });

  it('asks for the equivalence when the unit needs one', async () => {
    await expect(
      service.create('user-1', {
        ingredientId: 'ingredient-1',
        quantity: 2,
        unit: Unit.CL,
      }),
    ).rejects.toThrow("renseigne d'abord son équivalence");
  });
  it('converts spoons into grams with the universal fallback (15 g) when the ingredient has no equivalence', async () => {
    prisma.stock.create.mockResolvedValue(ownedStock);

    await service.create('user-1', {
      ingredientId: 'ingredient-1',
      quantity: 2,
      unit: Unit.CUILLERE_A_SOUPE,
    });

    const [args] = prisma.stock.create.mock.calls[0] as [
      { data: { quantity: number; unit: Unit } },
    ];
    expect(args.data).toMatchObject({ quantity: 30, unit: Unit.G });
  });
});
