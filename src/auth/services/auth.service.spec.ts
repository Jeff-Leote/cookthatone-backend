import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/services/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };

  const existingUser = {
    id: 'user-1',
    email: 'jane@example.com',
    passwordHash: '',
  };

  beforeAll(async () => {
    existingUser.passwordHash = await bcrypt.hash('correct-password', 10);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('signed.jwt.token') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // T01: register() avec un email nouveau + password -> access_token retourne
  it('registers a new user and returns an access_token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
    });

    const result = await service.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(result).toEqual({ access_token: 'signed.jwt.token' });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  // T02: register() avec un email deja existant -> ConflictException (409)
  it('throws ConflictException when the email is already registered', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    await expect(
      service.register({ email: existingUser.email, password: 'password123' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // T03: login() avec des credentials valides -> access_token retourne
  it('logs in with valid credentials and returns an access_token', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    const result = await service.login({
      email: existingUser.email,
      password: 'correct-password',
    });

    expect(result).toEqual({ access_token: 'signed.jwt.token' });
  });

  // T04: login() avec un mauvais mot de passe -> UnauthorizedException (401)
  it('throws UnauthorizedException on a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    await expect(
      service.login({ email: existingUser.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // T05: login() avec un email inconnu -> UnauthorizedException (401)
  it('throws UnauthorizedException when the email is unknown', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'unknown@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
