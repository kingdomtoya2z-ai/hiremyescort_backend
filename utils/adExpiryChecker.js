import { Product } from "../models/productModel.js";
import { User } from "../models/userModel.js";
import { sendAdExpiryMail } from "../emailVerify/sendAdStatusMail.js";
import { getExpiryLabel } from "./adValidation.js";

// Main function to check and expire ads
export const createCheckAndExpireAds = () => {
  return async () => {
    try {
      console.log("⏰ Running ad expiry check job...");

      // Find all approved ads that haven't expired yet
      const approvedAds = await Product.find({
        status: "approved",
        isExpired: false,
        expiryDate: { $lt: new Date() },
      });

      if (approvedAds.length === 0) {
        console.log("✅ No ads to expire at this time");
        return;
      }

      console.log(`📋 Found ${approvedAds.length} ads to expire`);

      for (const ad of approvedAds) {
        try {
          /**
           * Mark the ad expired. No coins are returned here and no
           * CoinTransaction is written: reaching the end of its paid window is
           * not a refundable event. Only an admin rejecting an ad refunds, which
           * is handled in rejectAd and is a separate path.
           */
          const updatedAd = await Product.findByIdAndUpdate(
            ad._id,
            {
              status: "rejected",
              isExpired: true,
              rejectReason:
                "Your ad has expired. Please resubmit to continue advertising.",
            },
            { new: true },
          );

          // Get user details for email
          const user = await User.findById(ad.userId);
          if (user && user.email) {
            try {
              const expiryPeriod = getExpiryLabel(ad.adType);

              await sendAdExpiryMail(
                user.email,
                ad.title,
                ad._id.toString(),
                ad.adType,
                expiryPeriod,
              );

              console.log(
                `📧 Expiry email sent to ${user.email} for ad ${ad._id}`,
              );
            } catch (emailError) {
              console.error(
                `❌ Failed to send expiry email for ad ${ad._id}:`,
                emailError.message,
              );
              // Don't fail the whole job if email fails
            }
          }

          console.log(`✅ Ad ${ad._id} moved to rejected status (expired)`);
        } catch (adError) {
          console.error(
            `❌ Error processing ad ${ad._id} for expiry:`,
            adError.message,
          );
          // Continue with next ad if one fails
        }
      }

      console.log("✅ Ad expiry check job completed successfully");
    } catch (error) {
      console.error(
        "❌ Error in ad expiry checker job:",
        error.message || error,
      );
    }
  };
};

export default createCheckAndExpireAds;
