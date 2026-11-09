import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../services/auth.service';
import { RegisterDto } from '../dtos/register.dto';
import { LoginDto } from '../dtos/login.dto';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { ResendVerificationDto } from '../dtos/resend-verification.dto';
import { ChangePasswordDto } from '../dtos/change-password.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

// 5 tentatives par minute et par IP : limite dediee contre le brute-force
// sur les identifiants, plus stricte que la limite globale de l'API.
const BRUTE_FORCE_THROTTLE = { default: { limit: 5, ttl: 60000 } };

// 3 requêtes par 15 minutes et par IP : évite le spam d'emails
// (réinitialisation de mot de passe, renvoi de vérification).
const EMAIL_SPAM_THROTTLE = { default: { limit: 3, ttl: 900000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(BRUTE_FORCE_THROTTLE)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(BRUTE_FORCE_THROTTLE)
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

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(EMAIL_SPAM_THROTTLE)
  @ApiOperation({
    summary: 'Demander un email de réinitialisation de mot de passe',
  })
  @ApiResponse({
    status: 200,
    description: "Message générique envoyé (que l'adresse existe ou non)",
  })
  @ApiResponse({ status: 400, description: 'Email invalide' })
  @ApiResponse({
    status: 429,
    description: 'Trop de demandes, réessaie plus tard',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(BRUTE_FORCE_THROTTLE)
  @ApiOperation({
    summary: 'Réinitialiser le mot de passe via le token reçu par email',
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe réinitialisé avec succès',
  })
  @ApiResponse({
    status: 400,
    description:
      'Données invalides (token absent ou nouveau mot de passe trop court)',
  })
  @ApiResponse({
    status: 401,
    description: 'Token invalide, expiré ou déjà utilisé',
  })
  @ApiResponse({
    status: 429,
    description: 'Trop de tentatives, réessaie plus tard',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle(EMAIL_SPAM_THROTTLE)
  @ApiOperation({ summary: "Renvoyer l'email de vérification de compte" })
  @ApiResponse({
    status: 200,
    description: "Message générique envoyé (que l'adresse existe ou non)",
  })
  @ApiResponse({ status: 400, description: 'Email invalide' })
  @ApiResponse({
    status: 429,
    description: 'Trop de demandes, réessaie plus tard',
  })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(BRUTE_FORCE_THROTTLE)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Changer son mot de passe (utilisateur connecté)' })
  @ApiResponse({ status: 200, description: 'Mot de passe modifié avec succès' })
  @ApiResponse({
    status: 400,
    description:
      "Données invalides (nouveau mot de passe trop court ou identique à l'ancien)",
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié ou mot de passe actuel incorrect',
  })
  @ApiResponse({
    status: 429,
    description: 'Trop de tentatives, réessaie plus tard',
  })
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
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
