import { Injectable, Logger } from '@nestjs/common';
import { Unit } from '@prisma/client';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

const UNIT_LABEL: Record<Unit, string> = {
  G: 'g',
  KG: 'kg',
  ML: 'ml',
  L: 'L',
  PIECE: 'pièce(s)',
  CUILLERE_A_SOUPE: 'cuillère(s) à soupe',
  CUILLERE_A_CAFE: 'cuillère(s) à café',
  TASSE: 'tasse(s)',
  PINCEE: 'pincée(s)',
};

export interface StockDeficit {
  ingredientName: string;
  missing: number;
  unit: Unit;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey = process.env.BREVO_API_KEY;
  private readonly fromEmail =
    process.env.EMAIL_FROM ?? 'no-reply@cookthatone.app';
  private readonly fromName = process.env.EMAIL_FROM_NAME ?? 'CookthatOne';

  async sendVerificationEmail(to: string, pseudo: string, verifyUrl: string) {
    await this.send(
      to,
      'Confirme ton adresse email — CookthatOne',
      `
        <p>Bonjour ${pseudo},</p>
        <p>Merci de t'être inscrit sur CookthatOne. Clique sur le lien ci-dessous pour valider ton adresse email et activer ton compte :</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>Ce lien expire dans 24 heures.</p>
      `,
      "l'email de vérification",
    );
  }

  async sendInsufficientStockEmail(
    to: string,
    pseudo: string,
    recipeTitle: string,
    deficits: StockDeficit[],
  ) {
    const items = deficits
      .map(
        (d) =>
          `<li>${d.ingredientName} : il vous manque ${d.missing} ${UNIT_LABEL[d.unit]}</li>`,
      )
      .join('');

    await this.send(
      to,
      `Stock insuffisant pour "${recipeTitle}" — CookthatOne`,
      `
        <p>Bonjour ${pseudo},</p>
        <p>Vous avez validé la recette <strong>${recipeTitle}</strong>, mais votre stock ne couvrait pas tous les ingrédients nécessaires :</p>
        <ul>${items}</ul>
        <p>N'oubliez pas de faire vos courses ou de remettre votre stock à jour.</p>
      `,
      "l'email de stock insuffisant",
    );
  }

  private async send(
    to: string,
    subject: string,
    htmlContent: string,
    description: string,
  ) {
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
          subject,
          htmlContent,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Brevo a renvoyé ${res.status} : ${body}`);
      }
    } catch (error) {
      // Un echec d'envoi ne doit jamais faire echouer l'operation metier
      // qui a declenche l'email (inscription, validation d'un repas...).
      this.logger.error(`Échec de l'envoi de ${description} à ${to}`, error);
    }
  }
}
