import { Injectable, Logger } from '@nestjs/common';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey = process.env.BREVO_API_KEY;
  private readonly fromEmail =
    process.env.EMAIL_FROM ?? 'no-reply@cookthatone.app';
  private readonly fromName = process.env.EMAIL_FROM_NAME ?? 'CookthatOne';

  async sendVerificationEmail(to: string, pseudo: string, verifyUrl: string) {
    try {
      const res = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': this.apiKey ?? '',
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromEmail },
          to: [{ email: to }],
          subject: 'Confirme ton adresse email — CookthatOne',
          htmlContent: `
            <p>Bonjour ${pseudo},</p>
            <p>Merci de t'être inscrit sur CookthatOne. Clique sur le lien ci-dessous pour valider ton adresse email et activer ton compte :</p>
            <p><a href="${verifyUrl}">${verifyUrl}</a></p>
            <p>Ce lien expire dans 24 heures.</p>
          `,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Brevo a renvoyé ${res.status} : ${body}`);
      }
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
