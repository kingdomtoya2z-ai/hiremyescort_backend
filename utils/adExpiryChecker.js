import { Product } from "../models/productModel.js";
import { User } from "../models/userModel.js";
import { sendAdExpiryMail } from "../emailVerify/sendAdStatusMail.js";

// Calculate expiry date based on ad type
const calculateExpiryDate = (adType, approvalDate) => {
  const expiryDate = new Date(approvalDate);

  if (adType === "premium") {
    // 1 month = 30 days for premium
    expiryDate.setDate(expiryDate.getDate() + 30);
  } else if (adType === "golden") {
    // 3 weeks = 21 days for golden
    expiryDate.setDate(expiryDate.getDate() + 21);
  } else {
    // 2 weeks = 14 days for free
    expiryDate.setDate(expiryDate.getDate() + 14);
  }

  return expiryDate;
};

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
          // Update ad status to rejected
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
              // Get ad type expiry info
              const expiryInfo = {
                free: "2 weeks",
                golden: "3 weeks",
                premium: "1 month",
              };

              const expiryPeriod = expiryInfo[ad.adType] || "validity period";

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
