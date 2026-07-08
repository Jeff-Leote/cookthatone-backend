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
      delete: jest.Mock;
    };
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
        delete: jest.fn(),
      },
    };

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
});
