import { Resend } from "resend";
import "dotenv/config";
import { escapeHtml } from "../utils/sanitize.js";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendAdApprovalMail = async (email, adTitle, adId) => {
  try {
    const safeTitle = escapeHtml(adTitle || "");
    const mailConfigurations = {
      from: "info@hiremyescort.com",
      to: email,
      subject: "Your Advertisement Has Been Approved",
      html: `
              <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
                  <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                      <h2 style="color: #9333ea; margin-bottom: 20px;">✓ Advertisement Approved</h2>
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          Great news! Your advertisement has been approved and is now live on HireMyEscort.
                      </p>
                      <div style="background-color: #f0f0f0; padding: 15px; border-left: 4px solid #9333ea; margin: 20px 0;">
                          <p style="margin: 5px 0; color: #555;"><strong>Ad Title:</strong> ${safeTitle}</p>
                          <p style="margin: 5px 0; color: #555;"><strong>Ad ID:</strong> ${adId}</p>
                      </div>
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          Your ad is now visible to potential clients. You can manage your advertisement from your dashboard.
                      </p>
                      <div style="text-align: center; margin-top: 30px;">
                          <a href="${process.env.FRONTEND_URL || "https://hiremyescort.com"}/dashboard" style="background-color: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">View Dashboard</a>
                      </div>
                      <p style="color: #999; font-size: 12px; margin-top: 30px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
                          If you have any questions, please contact our support team.
                      </p>
                  </div>
              </div>
          `,
    };

    const info = await resend.emails.send(mailConfigurations);
    if (info.error) {
      throw new Error(info.error.message);
    }
    return info;
  } catch (error) {
    console.error("Error sending approval email:", error);
    throw error;
  }
};

export const sendAdRejectionMail = async (
  email,
  adTitle,
  adId,
  reason,
  refundAmount = 0,
  remainingCoins = 0,
) => {
  try {
    const safeTitle = escapeHtml(adTitle || "");
    const safeReason = escapeHtml(reason || "Please review our posting guidelines");
    let refundHTML = "";
    if (refundAmount > 0) {
      refundHTML = `
                      <div style="background-color: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0;">
                          <h3 style="color: #155724; margin-top: 0;">💰 Coins Refunded</h3>
                          <p style="margin: 5px 0; color: #155724;"><strong>Refund Amount:</strong> ${refundAmount} coins</p>
                          <p style="margin: 5px 0; color: #155724;"><strong>Your New Balance:</strong> ${remainingCoins} coins</p>
                      </div>
                  `;
    }

    const mailConfigurations = {
      from: "info@hiremyescort.com",
      to: email,
      subject: `Your Advertisement Has Been Rejected${refundAmount > 0 ? " - Coins Refunded" : ""}`,
      html: `
              <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
                  <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                      <h2 style="color: #dc2626; margin-bottom: 20px;">✗ Advertisement Rejected</h2>
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          We regret to inform you that your advertisement has been rejected.
                      </p>
                      <div style="background-color: #fef2f2; padding: 15px; border-left: 4px solid #dc2626; margin: 20px 0;">
                          <p style="margin: 5px 0; color: #555;"><strong>Ad Title:</strong> ${safeTitle}</p>
                          <p style="margin: 5px 0; color: #555;"><strong>Ad ID:</strong> ${adId}</p>
                          <p style="margin: 5px 0; color: #d32f2f;"><strong>Reason:</strong> ${safeReason}</p>
                      </div>
                      ${refundHTML}
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          Please review the rejection reason and make necessary changes to comply with our community guidelines. You can resubmit your advertisement after making the corrections.
                      </p>
                      <div style="text-align: center; margin-top: 30px;">
                          <a href="${process.env.FRONTEND_URL || "https://hiremyescort.com"}/dashboard" style="background-color: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a>
                      </div>
                      <p style="color: #999; font-size: 12px; margin-top: 30px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
                          If you believe this is an error, please contact our support team for assistance.
                        </p>
                  </div>
              </div>
          `,
    };


    const info = await resend.emails.send(mailConfigurations);
    if (info.error) {
      throw new Error(info.error.message);
    }
    return info;
  } catch (error) {
    throw error;
  }
};


export const sendDeleteEmail = async (
  email

) => {
  try {
    

    const mailConfigurations = {
      from: "info@hiremyescort.com",
      to: email,
      subject: `Your Acoount is been suspended and permanently deleted by our Admin`,
      html: `
              <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
                  <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                      <h2 style="color: #dc2626; margin-bottom: 20px;">✗ We Regret To Tell You That Your Account Has Been deleted permanently from our database</h2>
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          We regret to inform you that your Account is suspended and deleted permanently from our database
                      </p>

                  </div>
              </div>
          `,
    };
    

    const info = await resend.emails.send(mailConfigurations);
    if (info.error) {
      throw new Error(info.error.message);
    }
    return info;
  } catch (error) {
    throw error;
  }
};

export const sendAdExpiryMail = async (email, adTitle, adId, adType, expiryPeriod) => {
  try {
    const safeTitle = escapeHtml(adTitle || "");
    const adTypeLabel = adType === "premium" ? "Premium" : adType === "golden" ? "Golden" : "Free";
    
    const mailConfigurations = {
      from: "info@hiremyescort.com",
      to: email,
      subject: "Your Advertisement Has Expired",
      html: `
              <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
                  <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                      <h2 style="color: #d32f2f; margin-bottom: 20px;">⏰ Your Advertisement Has Expired</h2>
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          Your ${adTypeLabel} advertisement has reached the end of its validity period (${expiryPeriod}) and has been moved to your rejected ads section.
                      </p>
                      <div style="background-color: #f0f0f0; padding: 15px; border-left: 4px solid #d32f2f; margin: 20px 0;">
                          <p style="margin: 5px 0; color: #555;"><strong>Ad Title:</strong> ${safeTitle}</p>
                          <p style="margin: 5px 0; color: #555;"><strong>Ad ID:</strong> ${adId}</p>
                          <p style="margin: 5px 0; color: #555;"><strong>Ad Type:</strong> ${adTypeLabel}</p>
                          <p style="margin: 5px 0; color: #555;"><strong>Validity Period:</strong> ${expiryPeriod}</p>
                      </div>
                      <p style="color: #333; font-size: 16px; line-height: 1.6;">
                          Don't worry! Your advertisement details are still saved. You can easily resubmit your ad from your Dashboard by visiting your rejected ads section.
                      </p>
                      <h3 style="color: #333; margin-top: 25px; margin-bottom: 15px;">How to Resubmit:</h3>
                      <ol style="color: #555; font-size: 16px; line-height: 1.8;">
                          <li>Log in to your HireMyEscort account</li>
                          <li>Go to your Dashboard</li>
                          <li>Navigate to the "Rejected Ads" section</li>
                          <li>Find your expired ad and click "Resubmit"</li>
                          <li>Review and make any updates if needed</li>
                          <li>Submit for approval again</li>
                      </ol>
                      <p style="color: #333; font-size: 16px; line-height: 1.6; margin-top: 20px;">
                          If you have a ${adTypeLabel} ad, the same coin deduction will apply upon resubmission. Check your coin balance in your Dashboard before resubmitting.
                      </p>
                      <div style="text-align: center; margin-top: 30px;">
                          <a href="https://hiremyescort.com/user-dashboard" style="display: inline-block; background-color: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                              Go to Dashboard
                          </a>
                      </div>
                      <p style="color: #999; font-size: 14px; text-align: center; margin-top: 30px;">
                          Questions? Contact our support team at support@hiremyescort.com
                      </p>
                  </div>
              </div>
          `,
    };

    const info = await resend.emails.send(mailConfigurations);
    if (info.error) {
      throw new Error(info.error.message);
    }
    return info;
  } catch (error) {
    throw error;
  }
};