import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/services/prisma.service';
import { RegisterDto } from '../dtos/register.dto';
import { LoginDto } from '../dtos/login.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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
    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, pseudo: dto.pseudo, passwordHash },
      });
      return { access_token: this.signToken(user.id) };
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

    return { access_token: this.signToken(user.id) };
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
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private signToken(userId: string): string {
    return this.jwtService.sign({ sub: userId });
  }
}
