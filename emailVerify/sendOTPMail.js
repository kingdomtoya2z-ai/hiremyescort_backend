import { Resend } from "resend";
import "dotenv/config";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOTPMail = async (otp, email) => {
  try {
    const mailConfigurations = {
      from: "HireMyEscort <info@hiremyescort.com>",
      to: email,
      subject: "Password Reset OTP",
      html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Password Reset OTP</h2>
                    <p>Your OTP for password reset is:</p>
                    <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #9333ea; margin: 0;">${otp}</h1>
                    </div>
                    <p style="color: #999; font-size: 12px;">This OTP will expire in 10 minutes.</p>
                </div>
            `,
    };

    const info = await resend.emails.send(mailConfigurations);
    if (info.error) {
      throw new Error(info.error.message);
    }
    return info;
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw error;
  }
};
