import { cleanupExpiredTokens } from "./tokenManager.js";
import createCheckAndExpireAds from "./adExpiryChecker.js";

// Schedule token cleanup to run every hour (3600000 ms)
export const startTokenCleanupJob = () => {
  console.log("🕐 Starting token cleanup scheduler...");

  // Run cleanup immediately on startup
  cleanupExpiredTokens();

  // Then run every hour
  setInterval(
    async () => {
      await cleanupExpiredTokens();
    },
    60 * 60 * 1000,
  ); // 1 hour in milliseconds

  console.log("✅ Token cleanup job scheduled to run every 1 hour");
};

// Schedule ad expiry check to run every 6 hours
export const startAdExpiryJob = () => {
  console.log("⏰ Starting ad expiry scheduler...");

  const checkAndExpireAds = createCheckAndExpireAds();

  // Run expiry check immediately on startup
  checkAndExpireAds();

  // Then run every 6 hours
  setInterval(
    async () => {
      await checkAndExpireAds();
    },
    6 * 60 * 60 * 1000,
  ); // 6 hours in milliseconds

  console.log("✅ Ad expiry job scheduled to run every 6 hours");
};

export default startTokenCleanupJob;
