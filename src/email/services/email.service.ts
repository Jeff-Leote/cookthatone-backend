import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  async sendVerificationEmail(to: string, pseudo: string, verifyUrl: string) {
    try {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Confirme ton adresse email — CookthatOne',
        html: `
          <p>Bonjour ${pseudo},</p>
          <p>Merci de t'être inscrit sur CookthatOne. Clique sur le lien ci-dessous pour valider ton adresse email et activer ton compte :</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>Ce lien expire dans 24 heures.</p>
        `,
      });
    } catch (error) {
      // L'inscription ne doit pas échouer si l'envoi de l'email échoue :
      // le compte reste créé, non vérifié, l'utilisateur pourra redemander
      // un email de vérification plus tard.
      this.logger.error(
        `Échec de l'envoi de l'email de vérification à ${to}`,
        error,
      );
    }
  }
}
