const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendContactEmail({ name, email, subject, message }) {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem;">
      <div style="background: #4f46e5; border-radius: 12px 12px 0 0; padding: 1.5rem 2rem;">
        <h1 style="color: white; margin: 0; font-size: 1.25rem;">New Contact Form Submission</h1>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 2rem;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b; width: 100px;">Name</td>
            <td style="padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; color: #1e293b;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">Email</td>
            <td style="padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; color: #1e293b;"><a href="mailto:${email}" style="color: #4f46e5;">${email}</a></td>
          </tr>
          <tr>
            <td style="padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">Subject</td>
            <td style="padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; color: #1e293b; font-weight: 600;">${subject}</td>
          </tr>
        </table>
        <div style="margin-top: 1.5rem;">
          <h3 style="font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.75rem;">Message</h3>
          <p style="color: #1e293b; line-height: 1.7; white-space: pre-wrap;">${message}</p>
        </div>
      </div>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from: 'CopyQuick Contact <onboarding@resend.dev>',
    to: ['support@copyquick.co'],
    subject: `[CopyQuick Contact] ${subject}`,
    html: html,
    reply_to: email,
  });

  if (error) {
    console.error('Resend email error:', error);
    throw new Error('Failed to send email');
  }

  console.log('Contact email sent successfully:', data?.id);
  return data;
}

module.exports = { sendContactEmail };