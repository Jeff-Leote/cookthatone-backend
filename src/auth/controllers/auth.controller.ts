import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import { RegisterDto } from '../dtos/register.dto';
import { LoginDto } from '../dtos/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.me(req.user.userId);
  }

  // Route destinée à être ouverte directement depuis le lien de l'email
  // (pas un appel API classique) : réponse HTML plutôt que JSON.
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Res() res: Response) {
    try {
      await this.authService.verifyEmail(token);
      res
        .status(HttpStatus.OK)
        .send(
          this.renderVerifyPage(
            'Adresse email vérifiée',
            'Ton compte est validé, tu peux maintenant te connecter.',
          ),
        );
    } catch {
      res
        .status(HttpStatus.UNAUTHORIZED)
        .send(
          this.renderVerifyPage(
            'Lien invalide',
            'Ce lien de vérification est invalide ou a expiré.',
          ),
        );
    }
  }

  private renderVerifyPage(title: string, message: string): string {
    return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>${title} — CookthatOne</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 4rem 1rem;">
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`;
  }
}
