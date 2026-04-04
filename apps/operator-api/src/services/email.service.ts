import nodemailer from 'nodemailer';

function getAppBaseUrl() {
    return process.env.APP_BASE_URL || 'https://app.syntraeai.com';
}

function getPublicSiteUrl() {
    return process.env.PUBLIC_SITE_URL || process.env.MARKETING_SITE_URL || 'https://syntraeai.com';
}

function getSupportEmail() {
    return process.env.SUPPORT_EMAIL || 'support@syntraeai.com';
}

export class EmailService {
    private static transporter: nodemailer.Transporter | null = null;

    static isConfigured() {
        return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM_EMAIL);
    }

    static async sendVerificationEmail(email: string, token: string, workspaceName: string) {
        const verifyUrl = `${getAppBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
        const subject = 'Verify your Syntrae account';
        const text = [
            `Welcome to Syntrae, ${workspaceName}.`,
            '',
            'Verify your email address to activate your account:',
            verifyUrl,
            '',
            'If you did not create this account, you can ignore this email.',
            `Support: ${getSupportEmail()}`,
        ].join('\n');
        const html = buildVerificationEmailHtml({
            workspaceName,
            verificationUrl: verifyUrl,
            supportEmail: getSupportEmail(),
        });

        return this.send({
            to: email,
            subject,
            text,
            html,
            fallbackUrl: verifyUrl,
        });
    }

    static async sendPasswordResetEmail(email: string, token: string) {
        const resetUrl = `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
        const subject = 'Reset your Syntrae password';
        const text = [
            'We received a request to reset your Syntrae password.',
            '',
            'Reset it here:',
            resetUrl,
            '',
            'If you did not request this, you can ignore this email.',
            `Support: ${getSupportEmail()}`,
        ].join('\n');

        return this.send({
            to: email,
            subject,
            text,
            html: `
                <p>We received a request to reset your Syntrae password.</p>
                <p>Reset it here:</p>
                <p><a href="${resetUrl}">${resetUrl}</a></p>
                <p>If you did not request this, you can ignore this email.</p>
                <p>Support: <a href="mailto:${getSupportEmail()}">${getSupportEmail()}</a></p>
            `,
            fallbackUrl: resetUrl,
        });
    }

    static getTrustLinks() {
        return {
            support_email: getSupportEmail(),
            privacy_url: `${getPublicSiteUrl()}/privacy`,
            terms_url: `${getPublicSiteUrl()}/terms`,
        };
    }

    private static async send(input: {
        to: string;
        subject: string;
        text: string;
        html: string;
        fallbackUrl: string;
    }) {
        if (!this.isConfigured()) {
            console.warn(`[EmailService] SMTP not configured. ${input.subject} -> ${input.to}: ${input.fallbackUrl}`);
            return {
                delivered: false,
                preview_url: input.fallbackUrl,
            };
        }

        const transporter = this.getTransporter();
        await transporter.sendMail({
            from: formatFromAddress(),
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
        });

        return { delivered: true };
    }

    private static getTransporter() {
        if (this.transporter) return this.transporter;

        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT),
            secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
            auth: process.env.SMTP_USERNAME
                ? {
                    user: process.env.SMTP_USERNAME,
                    pass: process.env.SMTP_PASSWORD,
                }
                : undefined,
        });

        return this.transporter;
    }
}

function formatFromAddress() {
    const name = process.env.SMTP_FROM_NAME || 'Syntrae';
    const email = process.env.SMTP_FROM_EMAIL || 'support@syntraeai.com';
    return `${name} <${email}>`;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildVerificationEmailHtml(input: {
    workspaceName: string;
    verificationUrl: string;
    supportEmail: string;
}) {
    const workspaceName = escapeHtml(input.workspaceName);
    const verificationUrl = escapeHtml(input.verificationUrl);
    const supportEmail = escapeHtml(input.supportEmail);

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verify your email - Syntrae</title>
    <style>
      body,
      table,
      td,
      a {
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
      }

      table,
      td {
        mso-table-lspace: 0pt;
        mso-table-rspace: 0pt;
      }

      img {
        -ms-interpolation-mode: bicubic;
        border: 0;
        outline: none;
        text-decoration: none;
      }

      table {
        border-collapse: collapse !important;
      }

      body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background-color: #f3f4f6;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .wrapper {
        width: 100%;
        table-layout: fixed;
        background-color: #f3f4f6;
        padding: 24px 0;
      }

      .main {
        background-color: #ffffff;
        margin: 0 auto;
        width: 100%;
        max-width: 600px;
        border-radius: 12px;
        overflow: hidden;
      }

      .content {
        padding: 40px 32px;
        font-family: Arial, Helvetica, sans-serif;
        color: #111827;
      }

      .brand {
        font-size: 22px;
        line-height: 28px;
        font-weight: 700;
        letter-spacing: -0.3px;
        color: #111827;
      }

      .eyebrow {
        font-size: 12px;
        line-height: 18px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b7280;
      }

      .title {
        margin: 12px 0 0 0;
        font-size: 28px;
        line-height: 36px;
        font-weight: 700;
        color: #111827;
      }

      .text {
        margin: 0;
        font-size: 16px;
        line-height: 26px;
        color: #374151;
      }

      .spacer-8 {
        height: 8px;
        line-height: 8px;
        font-size: 8px;
      }

      .spacer-16 {
        height: 16px;
        line-height: 16px;
        font-size: 16px;
      }

      .spacer-24 {
        height: 24px;
        line-height: 24px;
        font-size: 24px;
      }

      .spacer-32 {
        height: 32px;
        line-height: 32px;
        font-size: 32px;
      }

      .button {
        display: inline-block;
        background-color: #111827;
        color: #ffffff !important;
        font-size: 16px;
        line-height: 16px;
        font-weight: 700;
        padding: 14px 24px;
        border-radius: 8px;
      }

      .info-box {
        background-color: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 16px;
      }

      .muted {
        font-size: 14px;
        line-height: 22px;
        color: #6b7280;
      }

      .footer {
        padding: 24px 32px 32px 32px;
        font-family: Arial, Helvetica, sans-serif;
        color: #6b7280;
        font-size: 13px;
        line-height: 21px;
        text-align: center;
      }

      .link {
        color: #2563eb;
        word-break: break-all;
      }

      @media screen and (max-width: 600px) {
        .content {
          padding: 32px 24px;
        }

        .footer {
          padding: 20px 24px 28px 24px;
        }

        .title {
          font-size: 24px !important;
          line-height: 32px !important;
        }

        .text {
          font-size: 15px !important;
          line-height: 24px !important;
        }

        .button {
          display: block !important;
          width: 100% !important;
          box-sizing: border-box !important;
          text-align: center !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        width="100%"
      >
        <tr>
          <td align="center">
            <table
              role="presentation"
              cellpadding="0"
              cellspacing="0"
              border="0"
              width="600"
              class="main"
            >
              <tr>
                <td class="content">
                  <div class="eyebrow">Account Verification</div>
                  <div class="brand">Syntrae</div>

                  <div class="spacer-24">&nbsp;</div>

                  <h1 class="title">Verify your email address</h1>

                  <div class="spacer-16">&nbsp;</div>

                  <p class="text">
                    Hi ${workspaceName},
                  </p>

                  <div class="spacer-16">&nbsp;</div>

                  <p class="text">
                    Welcome to <strong>Syntrae</strong>. To complete your account
                    setup and activate your workspace, please verify your email
                    address using the button below.
                  </p>

                  <div class="spacer-32">&nbsp;</div>

                  <table
                    role="presentation"
                    cellpadding="0"
                    cellspacing="0"
                    border="0"
                  >
                    <tr>
                      <td align="left">
                        <a
                          href="${verificationUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="button"
                        >
                          Verify Email Address
                        </a>
                      </td>
                    </tr>
                  </table>

                  <div class="spacer-24">&nbsp;</div>

                  <div class="info-box">
                    <p class="muted" style="margin: 0 0 10px 0;">
                      If the button above does not work, copy and paste this link
                      into your browser:
                    </p>
                    <p class="muted" style="margin: 0;">
                      <a href="${verificationUrl}" class="link">
                        ${verificationUrl}
                      </a>
                    </p>
                  </div>

                  <div class="spacer-24">&nbsp;</div>

                  <p class="text">
                    For security reasons, this verification link may expire after
                    a limited time.
                  </p>

                  <div class="spacer-16">&nbsp;</div>

                  <p class="text">
                    If you did not create a Syntrae account, you can safely ignore
                    this email. No further action is required.
                  </p>

                  <div class="spacer-24">&nbsp;</div>

                  <p class="text" style="margin: 0;">
                    Need help? Contact us at
                    <a href="mailto:${supportEmail}" class="link">
                      ${supportEmail}
                    </a>.
                  </p>
                </td>
              </tr>

              <tr>
                <td class="footer">
                  <div style="font-weight: 700; color: #111827; margin-bottom: 6px;">
                    Syntrae
                  </div>
                  <div>
                    Intelligent workflow automation for modern teams
                  </div>
                  <div style="margin-top: 10px;">
                    <a href="https://app.syntraeai.com" class="link">
                      app.syntraeai.com
                    </a>
                  </div>
                  <div style="margin-top: 14px;">
                    This email was sent in response to a request to create or
                    activate a Syntrae account.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
}
