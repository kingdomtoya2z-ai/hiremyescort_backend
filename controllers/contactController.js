import { Resend } from "resend";
import { escapeHtml, ensureString } from "../utils/sanitize.js";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendContactEmail = async (req, res) => {
  try {
    const rawName = ensureString(req.body.name);
    const rawEmail = ensureString(req.body.email);
    const rawSubject = ensureString(req.body.subject);
    const rawMessage = ensureString(req.body.message);

    // Validation
    if (!rawName || !rawEmail || !rawMessage) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and message are required fields",
      });
    }

    const safeName = escapeHtml(rawName);
    const safeEmail = escapeHtml(rawEmail);
    const safeSubject = escapeHtml(rawSubject || "General Inquiry");
    const safeMessage = escapeHtml(rawMessage);

    // Send email to admin via Resend
    const response = await resend.emails.send({
      from: "HireMyEscort <info@hiremyescort.com>",
      to: "info@hiremyescort.com",
      subject: `New Contact Form Submission: ${rawSubject || "General Inquiry"}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <h2 style="color: #333; border-bottom: 3px solid #ec4899; padding-bottom: 10px;">New Contact Form Submission</h2>
          
          <div style="background-color: white; padding: 20px; border-radius: 8px; margin-top: 20px;">
            <p style="margin: 10px 0;"><strong>Name:</strong> ${safeName}</p>
            <p style="margin: 10px 0;"><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
            <p style="margin: 10px 0;"><strong>Subject:</strong> ${safeSubject}</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            
            <h3 style="color: #333; margin-top: 15px;">Message:</h3>
            <p style="color: #555; line-height: 1.6; white-space: pre-wrap;">${safeMessage}</p>
          </div>
          
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; font-size: 12px; color: #888;">
            <p>This is an automated message from HireMyEscort contact form.</p>
            <p>Submitted on: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `,
    });

    // Send confirmation email to user
    try {
      await resend.emails.send({
        from: "HireMyEscort <info@hiremyescort.com>",
        to: rawEmail,
        subject: "We Received Your Message - HireMyEscort",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <h2 style="color: #333; border-bottom: 3px solid #ec4899; padding-bottom: 10px;">Thank You for Contacting Us!</h2>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin-top: 20px;">
              <p>Hi ${safeName},</p>
              <p style="color: #555; line-height: 1.6;">We have received your message and appreciate you reaching out to HireMyEscort. Our team will review your inquiry and get back to you as soon as possible, typically within 24-48 hours.</p>
              
              <h3 style="color: #333; margin-top: 20px;">Your Message Details:</h3>
              <p style="margin: 10px 0;"><strong>Subject:</strong> ${safeSubject}</p>
              <p style="color: #888; font-size: 12px;">Submitted on: ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="margin-top: 20px; padding: 15px; background-color: #f0f0f0; border-left: 4px solid #ec4899; border-radius: 4px;">
              <p style="color: #555; margin: 0;">If you don't hear from us within 48 hours, please check your spam folder or contact us directly at <strong>info@hiremyescort.com</strong></p>
            </div>
            
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
              <p style="color: #888; font-size: 12px;">Best regards,<br>HireMyEscort Team</p>
            </div>
          </div>
        `,
      });
    } catch (confirmationError) {
      console.error("Failed to send confirmation email:", confirmationError);
      // Don't fail the request if confirmation email fails
    }

    return res.status(200).json({
      success: true,
      message:
        "Your message has been sent successfully. We'll get back to you soon!",
      id: response.id,
    });
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send your message. Please try again later.",
      error: error.message,
    });
  }
};
