import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/services/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { RegisterDto } from '../dtos/register.dto';
import { LoginDto } from '../dtos/login.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

const SALT_ROUNDS = 10;
const EMAIL_VERIFICATION_PURPOSE = 'email-verification';
const EMAIL_VERIFICATION_EXPIRY = '24h';
const PASSWORD_RESET_PURPOSE = 'password-reset';
const PASSWORD_RESET_EXPIRY = '1h';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { pseudo: dto.pseudo }] },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === dto.email
          ? 'Cette adresse email est déjà utilisée'
          : 'Ce pseudo est déjà pris',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { email: dto.email, pseudo: dto.pseudo, passwordHash },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Cette adresse email ou ce pseudo est déjà utilisé',
        );
      }
      throw error;
    }

    await this.emailService.sendVerificationEmail(
      user.email,
      user.pseudo,
      this.buildVerificationUrl(user.id),
    );

    return {
      message:
        'Compte créé. Vérifie ta boîte mail pour valider ton adresse email avant de te connecter.',
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException(
        'Les informations entrées sont incorrectes',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException(
        'Les informations entrées sont incorrectes',
      );
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Merci de valider ton adresse email avant de te connecter',
      );
    }

    const refreshToken = await this.createRefreshToken(user.id);
    return {
      access_token: this.signToken(user.id),
      refresh_token: refreshToken,
    };
  }

  async verifyEmail(token: string) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException(
        'Ce lien de vérification est invalide ou a expiré',
      );
    }

    if (payload.purpose !== EMAIL_VERIFICATION_PURPOSE) {
      throw new UnauthorizedException('Ce lien de vérification est invalide');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Ce lien de vérification est invalide');
    }

    if (!user.emailVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }

    return { verified: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException(
        'Session invalide, merci de te reconnecter',
      );
    }

    return {
      id: user.id,
      email: user.email,
      pseudo: user.pseudo,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // Envoie un email de réinitialisation si l'adresse existe. La réponse est
  // toujours identique pour ne pas révéler si un compte est enregistré.
  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = this.jwtService.sign(
        { sub: user.id, purpose: PASSWORD_RESET_PURPOSE },
        { expiresIn: PASSWORD_RESET_EXPIRY },
      );
      // On stocke un hash du token pour qu'un token utilisé ou révoqué ne
      // soit plus accepté, même si sa signature JWT est encore valide.
      const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 h
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: tokenHash, passwordResetExpiry: expiry },
      });
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
      await this.emailService.sendPasswordResetEmail(
        user.email,
        user.pseudo,
        resetUrl,
      );
    }

    return {
      message:
        'Si cette adresse est associée à un compte, tu vas recevoir un email pour réinitialiser ton mot de passe.',
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException(
        'Ce lien de réinitialisation est invalide ou a expiré',
      );
    }

    if (payload.purpose !== PASSWORD_RESET_PURPOSE) {
      throw new UnauthorizedException(
        'Ce lien de réinitialisation est invalide',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException(
        'Ce lien de réinitialisation est invalide',
      );
    }

    // Vérifie que le token n'a pas déjà été utilisé (ou révoqué via un nouveau
    // forgotPassword qui l'aurait écrasé).
    if (!user.passwordResetToken) {
      throw new UnauthorizedException(
        'Ce lien de réinitialisation est invalide',
      );
    }

    const tokenMatches = await bcrypt.compare(token, user.passwordResetToken);
    if (!tokenMatches) {
      throw new UnauthorizedException(
        'Ce lien de réinitialisation est invalide',
      );
    }

    if (!user.passwordResetExpiry || user.passwordResetExpiry <= new Date()) {
      throw new UnauthorizedException(
        'Ce lien de réinitialisation est invalide ou a expiré',
      );
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException(
        "Le nouveau mot de passe doit être différent de l'ancien",
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    return { message: 'Ton mot de passe a bien été réinitialisé.' };
  }

  // Renvoi du mail de vérification. La réponse est toujours identique pour
  // ne pas révéler si un compte est enregistré ou déjà vérifié.
  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      await this.emailService.sendVerificationEmail(
        user.email,
        user.pseudo,
        this.buildVerificationUrl(user.id),
      );
    }

    return {
      message:
        'Si cette adresse est associée à un compte non vérifié, tu vas recevoir un nouvel email de confirmation.',
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException(
        'Session invalide, merci de te reconnecter',
      );
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException(
        "Le nouveau mot de passe doit être différent de l'ancien",
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    return { message: 'Ton mot de passe a bien été modifié.' };
  }

  async refresh(
    rawToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored) {
      throw new UnauthorizedException(
        'Session expirée, merci de te reconnecter',
      );
    }
    if (stored.expiresAt <= new Date()) {
      await this.prisma.refreshToken.delete({ where: { tokenHash } });
      throw new UnauthorizedException(
        'Session expirée, merci de te reconnecter',
      );
    }
    // Rotation atomique : supprime l'ancien token et crée le nouveau en une
    // seule transaction pour éviter qu'une coupure laisse le client sans token.
    const newRawToken = randomBytes(32).toString('hex');
    const newTokenHash = createHash('sha256').update(newRawToken).digest('hex');
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { tokenHash } }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          userId: stored.userId,
          expiresAt: newExpiresAt,
        },
      }),
    ]);

    return {
      access_token: this.signToken(stored.userId),
      refresh_token: newRawToken,
    };
  }

  async logout(rawToken: string): Promise<{ message: string }> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
    return { message: 'Déconnecté.' };
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    // SHA-256 suffit ici : le token source est randomBytes(32) = 256 bits d'entropie,
    // ce qui rend le brute-force impossible. Contrairement au password reset (token JWT
    // prévisible), bcrypt n'apporte rien de plus pour un token purement aléatoire.
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    await this.prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });
    return rawToken;
  }

  private signToken(userId: string): string {
    return this.jwtService.sign({ sub: userId });
  }

  private buildVerificationUrl(userId: string): string {
    const token = this.jwtService.sign(
      { sub: userId, purpose: EMAIL_VERIFICATION_PURPOSE },
      { expiresIn: EMAIL_VERIFICATION_EXPIRY },
    );
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
    return `${apiUrl}/auth/verify-email?token=${token}`;
  }
}
