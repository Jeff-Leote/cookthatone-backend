import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/services/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let emailService: { sendVerificationEmail: jest.Mock };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };

  const existingUser = {
    id: 'user-1',
    email: 'jane@example.com',
    pseudo: 'jane',
    passwordHash: '',
    emailVerified: true,
  };

  beforeAll(async () => {
    existingUser.passwordHash = await bcrypt.hash('correct-password', 10);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    emailService = { sendVerificationEmail: jest.fn() };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // T01: register() avec un email + pseudo nouveaux + password -> compte créé,
  // email de vérification envoyé, pas d'access_token (compte non vérifié)
  it('registers a new user and sends a verification email', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      pseudo: 'newchef',
    });

    const result = await service.register({
      email: 'new@example.com',
      pseudo: 'newchef',
      password: 'password123',
    });

    expect(result).toEqual({
      message:
        'Compte créé. Vérifie ta boîte mail pour valider ton adresse email avant de te connecter.',
    });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      'new@example.com',
      'newchef',
      expect.stringContaining('/auth/verify-email?token='),
    );
  });

  // T02: register() avec un email deja existant -> ConflictException (409)
  it('throws ConflictException when the email is already registered', async () => {
    prisma.user.findFirst.mockResolvedValue(existingUser);

    await expect(
      service.register({
        email: existingUser.email,
        pseudo: 'anotherpseudo',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // register() avec un pseudo deja existant -> ConflictException (409)
  it('throws ConflictException when the pseudo is already registered', async () => {
    prisma.user.findFirst.mockResolvedValue(existingUser);

    await expect(
      service.register({
        email: 'another@example.com',
        pseudo: existingUser.pseudo,
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // Race condition : deux register() concurrents passent tous les deux le
  // findFirst(), le second create() viole la contrainte unique -> doit
  // rester une ConflictException (409), pas une erreur Prisma brute
  it('throws ConflictException when create() hits the unique constraint (concurrent register)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(
      service.register({
        email: existingUser.email,
        pseudo: existingUser.pseudo,
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // T03: login() avec des credentials valides + compte vérifié -> access_token retourne
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

  // login() avec un compte dont l'email n'est pas vérifié -> UnauthorizedException (401)
  it('throws UnauthorizedException when the email is not verified yet', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      emailVerified: false,
    });

    await expect(
      service.login({
        email: existingUser.email,
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // verifyEmail() avec un token valide -> marque le compte comme vérifié
  it('marks the account as verified with a valid token', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-2',
      purpose: 'email-verification',
    });
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      id: 'user-2',
      emailVerified: false,
    });

    const result = await service.verifyEmail('valid.jwt.token');

    expect(result).toEqual({ verified: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { emailVerified: true },
    });
  });

  // verifyEmail() avec un token dont la signature est invalide/expirée -> UnauthorizedException (401)
  it('throws UnauthorizedException when the verification token is invalid or expired', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(service.verifyEmail('bad.jwt.token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // verifyEmail() avec un token valide mais pas destiné à la vérification
  // d'email (ex. détourné d'un autre usage) -> UnauthorizedException (401)
  it('throws UnauthorizedException when the token purpose does not match', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-2' });

    await expect(service.verifyEmail('other.jwt.token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
