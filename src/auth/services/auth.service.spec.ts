import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
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
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let emailService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };

  const existingUser: {
    id: string;
    email: string;
    pseudo: string;
    passwordHash: string;
    emailVerified: boolean;
    passwordResetToken: string | null;
    passwordResetExpiry: Date | null;
  } = {
    id: 'user-1',
    email: 'jane@example.com',
    pseudo: 'jane',
    passwordHash: '',
    emailVerified: true,
    passwordResetToken: null,
    passwordResetExpiry: null,
  };

  // Hash du token utilisé dans les cas nominaux de resetPassword
  let validResetTokenHash: string;

  beforeAll(async () => {
    existingUser.passwordHash = await bcrypt.hash('correct-password', 10);
    validResetTokenHash = await bcrypt.hash('valid-reset.jwt.token', 10);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // $transaction exécute le tableau d'opérations passé (compatibilité
      // avec le mode « batch » utilisé dans refresh()).
      $transaction: jest
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    emailService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    };
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

  // T02: register() avec un email déjà existant -> ConflictException (409)
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

  // register() avec un pseudo déjà existant -> ConflictException (409)
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

  // T03: login() avec des credentials valides + compte vérifié -> access_token + refresh_token retournés
  it('logs in with valid credentials and returns an access_token and refresh_token', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.refreshToken.create.mockResolvedValue({});

    const result = await service.login({
      email: existingUser.email,
      password: 'correct-password',
    });

    expect(result.access_token).toBe('signed.jwt.token');
    expect(typeof result.refresh_token).toBe('string');
    expect(result.refresh_token).toHaveLength(64);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
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

  // verifyEmail() avec un token ayant purpose 'password-reset' -> rejeté (401)
  // (garantit l'isolation entre les deux types de tokens)
  it('throws UnauthorizedException when a password-reset token is used for verifyEmail', async () => {
    jwtService.verify.mockReturnValue({
      sub: existingUser.id,
      purpose: 'password-reset',
    });

    await expect(
      service.verifyEmail('password-reset.jwt.token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // forgotPassword() avec un email connu -> hash du token stocké en base,
  // email de réinitialisation envoyé, réponse générique (pas de fuite d'info)
  it('sends a password reset email when the address is registered', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.user.update.mockResolvedValue({ ...existingUser });

    const result = await service.forgotPassword(existingUser.email);

    expect(result.message).toContain('Si cette adresse');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const forgotCall = (
      prisma.user.update.mock.calls as Array<
        [
          {
            where: { id: string };
            data: { passwordResetToken: string; passwordResetExpiry: Date };
          },
        ]
      >
    )[0][0];
    expect(forgotCall.where).toEqual({ id: existingUser.id });
    expect(typeof forgotCall.data.passwordResetToken).toBe('string');
    expect(forgotCall.data.passwordResetExpiry).toBeInstanceOf(Date);
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      existingUser.email,
      existingUser.pseudo,
      expect.stringContaining('/reset-password?token='),
    );
  });

  // forgotPassword() avec un email inconnu -> réponse identique, pas d'email envoyé
  it('returns the same generic message when the address is unknown', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.forgotPassword('unknown@example.com');

    expect(result.message).toContain('Si cette adresse');
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  // resetPassword() avec un token valide -> mot de passe mis à jour, token effacé en base
  it('updates the password hash with a valid reset token', async () => {
    jwtService.verify.mockReturnValue({
      sub: existingUser.id,
      purpose: 'password-reset',
    });
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      passwordResetToken: validResetTokenHash,
      passwordResetExpiry: new Date(Date.now() + 30 * 60 * 1000), // dans 30 min
    });
    prisma.user.update.mockResolvedValue({ ...existingUser });

    const result = await service.resetPassword(
      'valid-reset.jwt.token',
      'newpassword123',
    );

    expect(result.message).toContain('réinitialisé');
    const resetCall = (
      prisma.user.update.mock.calls as Array<
        [
          {
            where: { id: string };
            data: { passwordResetToken: null; passwordResetExpiry: null };
          },
        ]
      >
    )[0][0];
    expect(resetCall.where).toEqual({ id: existingUser.id });
    expect(resetCall.data.passwordResetToken).toBeNull();
    expect(resetCall.data.passwordResetExpiry).toBeNull();
  });

  // resetPassword() avec un token expiré -> UnauthorizedException (401)
  it('throws UnauthorizedException when the reset token is expired', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(
      service.resetPassword('expired.jwt.token', 'newpassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // resetPassword() avec un token ayant purpose 'email-verification' -> rejeté (401)
  it('throws UnauthorizedException when an email-verification token is used for resetPassword', async () => {
    jwtService.verify.mockReturnValue({
      sub: existingUser.id,
      purpose: 'email-verification',
    });

    await expect(
      service.resetPassword('verify.jwt.token', 'newpassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // resetPassword() avec un nouveau mot de passe identique à l'ancien -> BadRequestException (400)
  it('throws BadRequestException when the new password is the same as the current one (resetPassword)', async () => {
    jwtService.verify.mockReturnValue({
      sub: existingUser.id,
      purpose: 'password-reset',
    });
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      passwordResetToken: validResetTokenHash,
      passwordResetExpiry: new Date(Date.now() + 30 * 60 * 1000),
    });

    await expect(
      service.resetPassword('valid-reset.jwt.token', 'correct-password'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // resetPassword() avec un userId inexistant dans le token -> UnauthorizedException (401)
  it('throws UnauthorizedException when the user in the reset token does not exist', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'ghost-user-id',
      purpose: 'password-reset',
    });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.resetPassword('ghost.jwt.token', 'newpassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // resetPassword() avec un token déjà utilisé (passwordResetToken null) -> UnauthorizedException (401)
  it('throws UnauthorizedException when the reset token has already been used', async () => {
    jwtService.verify.mockReturnValue({
      sub: existingUser.id,
      purpose: 'password-reset',
    });
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      passwordResetToken: null,
      passwordResetExpiry: null,
    });

    await expect(
      service.resetPassword('used.jwt.token', 'newpassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // resetPassword() avec un token expiré (passwordResetExpiry dans le passé) -> UnauthorizedException (401)
  it('throws UnauthorizedException when the reset token is expired in DB', async () => {
    jwtService.verify.mockReturnValue({
      sub: existingUser.id,
      purpose: 'password-reset',
    });
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      passwordResetToken: validResetTokenHash,
      passwordResetExpiry: new Date(Date.now() - 1000), // 1 seconde dans le passé
    });

    await expect(
      service.resetPassword('valid-reset.jwt.token', 'newpassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // resendVerification() avec un email connu et non vérifié -> email renvoyé
  it('resends the verification email when the account exists and is unverified', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      emailVerified: false,
    });

    const result = await service.resendVerification(existingUser.email);

    expect(result.message).toContain('Si cette adresse');
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      existingUser.email,
      existingUser.pseudo,
      expect.stringContaining('/auth/verify-email?token='),
    );
  });

  // resendVerification() avec un compte déjà vérifié -> pas d'email, réponse identique
  it('does not send an email when the account is already verified', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser); // emailVerified: true

    const result = await service.resendVerification(existingUser.email);

    expect(result.message).toContain('Si cette adresse');
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  // resendVerification() avec un email inconnu -> réponse identique, pas d'email
  it('returns the same generic message when the address is unknown for resend', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.resendVerification('unknown@example.com');

    expect(result.message).toContain('Si cette adresse');
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  // changePassword() nominal : mot de passe actuel correct -> mis à jour
  it('changes the password when currentPassword is correct', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.user.update.mockResolvedValue({ ...existingUser });

    const result = await service.changePassword(
      existingUser.id,
      'correct-password',
      'newpassword123',
    );

    expect(result.message).toContain('modifié');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: existingUser.id } }),
    );
  });

  // changePassword() avec un nouveau mot de passe identique à l'ancien -> BadRequestException (400)
  it('throws BadRequestException when the new password is the same as the current one (changePassword)', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    await expect(
      service.changePassword(
        existingUser.id,
        'correct-password',
        'correct-password',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // changePassword() avec un mauvais mot de passe actuel -> UnauthorizedException (401)
  it('throws UnauthorizedException when currentPassword is wrong', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    await expect(
      service.changePassword(
        existingUser.id,
        'wrong-password',
        'newpassword123',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // changePassword() avec un userId inexistant (session invalide) -> UnauthorizedException (401)
  it('throws UnauthorizedException when the user does not exist for changePassword', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.changePassword('ghost-id', 'correct-password', 'newpassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // T18: refresh() avec un token valide -> { access_token, refresh_token }
  it('refresh() returns new access_token and refresh_token for a valid token', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const storedRecord = {
      id: '1',
      tokenHash,
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 999999),
      createdAt: new Date(),
    };
    prisma.refreshToken.findUnique.mockResolvedValue(storedRecord);
    // delete et create sont appelés à l'intérieur du tableau passé à $transaction
    prisma.refreshToken.delete.mockResolvedValue(storedRecord);
    prisma.refreshToken.create.mockResolvedValue(storedRecord);

    const result = await service.refresh(rawToken);

    expect(result.access_token).toBe('signed.jwt.token');
    expect(typeof result.refresh_token).toBe('string');
    expect(result.refresh_token).toHaveLength(64);
    // La rotation doit passer par $transaction (atomicité)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  // T19: refresh() avec un token inexistant -> UnauthorizedException (401)
  it('refresh() throws UnauthorizedException when the token is not found', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(
      service.refresh(randomBytes(32).toString('hex')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.delete).not.toHaveBeenCalled();
  });

  // T20: refresh() avec un token expiré (expiresAt dans le passé) -> UnauthorizedException (401)
  it('refresh() throws UnauthorizedException and deletes the expired token', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiredRecord = {
      id: '2',
      tokenHash,
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000), // 1 seconde dans le passé
      createdAt: new Date(),
    };
    prisma.refreshToken.findUnique.mockResolvedValue(expiredRecord);
    prisma.refreshToken.delete.mockResolvedValue(expiredRecord);

    await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Le token expiré doit être supprimé proprement
    expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
      where: { tokenHash },
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  // T21: logout() token quelconque -> résout sans erreur (deleteMany appelé)
  it('logout() resolves without error and calls deleteMany', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.logout(rawToken);

    expect(result).toEqual({ message: 'Déconnecté.' });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash },
    });
  });
});
