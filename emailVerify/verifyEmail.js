import { Resend } from "resend";
import "dotenv/config";

const resend = new Resend(process.env.RESEND_API_KEY);

export const verifyEmail = async (token, email) => {
  try {
    const mailConfigurations = {
      from: "HireMyEscort <info@hiremyescort.com>",
      to: email,
      subject: "Email Verification",
      html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Email Verification</h2>
                    <p>Thank you for registering! Please click the link below to verify your email:</p>
                    <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/verify/${token}" style="background-color: #9333ea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        Verify Email
                    </a>
                    <p style="margin-top: 20px; color: #999; font-size: 12px;">Or copy this link: ${process.env.FRONTEND_URL || "http://localhost:5173"}/verify/${token}</p>
                </div>
            `,
    };

    const info = await resend.emails.send(mailConfigurations);
    if (info.error) {
      throw new Error(info.error.message);
    }
    return info;
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};
