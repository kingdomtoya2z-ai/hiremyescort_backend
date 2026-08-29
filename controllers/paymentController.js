import mongoose from "mongoose";
import { User } from "../models/userModel.js";
import { CoinTransaction } from "../models/coinTransactionModel.js";
import { calculateCoins } from "../utils/coinCalculator.js";
import { ensureString } from "../utils/sanitize.js";

// Unlimit API configuration
const UNLIMIT_API_KEY = process.env.UNLIMIT_API_KEY;
const UNLIMIT_BASE_URL = "https://api.unlimit.com/api/v1";

// Get user coins
export const getUserCoins = async (req, res) => {
  try {
    const userId = req.id;
    const user = await User.findById(userId).select("coins");

    return res.status(200).json({
      success: true,
      coins: user.coins,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get coins used by user (total coins deducted for ads)
export const getUserCoinUsage = async (req, res) => {
  try {
    const userId = req.id;
    console.log("📊 getUserCoinUsage called for userId:", userId);
    console.log("   Type of userId:", typeof userId);

    // Validate userId
    if (!userId) {
      console.warn("⚠️ No userId provided");
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Convert userId to ObjectId safely
    let userObjectId;
    try {
      userObjectId = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;
      console.log("✅ Converted userId to ObjectId:", userObjectId.toString());
    } catch (err) {
      console.error("❌ Invalid ObjectId conversion:", err.message);
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Get total coins deducted
    let totalDeducted = 0;
    let deductedCount = 0;
    let deductedTransactions = [];

    try {
      console.log("🔍 Querying CoinTransaction with filter:", {
        userId: userObjectId.toString(),
        transactionType: "deducted",
        status: "completed",
      });

      deductedTransactions = await CoinTransaction.find({
        userId: userObjectId,
        transactionType: "deducted",
        status: "completed",
      }).lean();

      console.log(
        "📋 Query result - Found",
        deductedTransactions.length,
        "deducted transactions",
      );

      if (
        Array.isArray(deductedTransactions) &&
        deductedTransactions.length > 0
      ) {
        deductedCount = deductedTransactions.length;
        console.log("✅ Detailed transaction list:");
        deductedTransactions.forEach((trans, idx) => {
          console.log(
            `   [${idx}] userId: ${trans.userId}, amount: ${trans.coinsAmount}, type: ${trans.adType}, created: ${trans.createdAt}`,
          );
          if (trans.coinsAmount && typeof trans.coinsAmount === "number") {
            totalDeducted += trans.coinsAmount;
          }
        });
        console.log("💰 Total deducted from all transactions:", totalDeducted);
      } else {
        console.warn(
          "⚠️ No deducted transactions found. Checking all CoinTransaction records...",
        );
        const allTransactions = await CoinTransaction.find({}).lean();
        console.log(
          "   Total CoinTransactions in database:",
          allTransactions.length,
        );
        if (allTransactions.length > 0) {
          console.log("   Sample transactions (first 3):");
          allTransactions.slice(0, 3).forEach((t, i) => {
            console.log(
              `     [${i}] userId: ${t.userId}, type: ${t.transactionType}, amount: ${t.coinsAmount}`,
            );
          });
        }
      }
      console.log(
        "💰 Final deducted - Count:",
        deductedCount,
        "Total:",
        totalDeducted,
      );
    } catch (err) {
      console.error("❌ Error querying deducted transactions:", err.message);
      console.error("   Error details:", err);
      totalDeducted = 0;
      deductedCount = 0;
    }

    // Get total coins refunded
    let totalRefunded = 0;
    let refundedCount = 0;

    try {
      const refundedTransactions = await CoinTransaction.find(
        {
          userId: userObjectId,
          transactionType: "refunded",
          status: "completed",
        },
        { coinsAmount: 1 },
      );

      if (Array.isArray(refundedTransactions)) {
        refundedCount = refundedTransactions.length;
        refundedTransactions.forEach((trans) => {
          if (trans.coinsAmount && typeof trans.coinsAmount === "number") {
            totalRefunded += trans.coinsAmount;
          }
        });
      }
      console.log(
        "🔄 Refunded - Count:",
        refundedCount,
        "Total:",
        totalRefunded,
      );
    } catch (err) {
      console.error("❌ Error querying refunded transactions:", err.message);
      totalRefunded = 0;
      refundedCount = 0;
    }

    const actualUsed = totalDeducted;

    console.log("✅ === COIN USAGE SUMMARY ===");
    console.log("   User ID:", userObjectId.toString());
    console.log(
      "   Total Deducted (Total Coins Spent):",
      totalDeducted,
      "(from",
      deductedCount,
      "transactions)",
    );
    console.log(
      "   Total Refunded (Ad Rejections):",
      totalRefunded,
      "(from",
      refundedCount,
      "transactions)",
    );
    console.log("   Actual Used (Total Coins Spent):", actualUsed);

    return res.status(200).json({
      success: true,
      coinsUsed: actualUsed,
      totalDeducted,
      totalRefunded,
      breakdown: {
        deductedTransactions: deductedCount,
        refundedTransactions: refundedCount,
      },
    });
  } catch (error) {
    console.error("❌ Unexpected error in getUserCoinUsage:", error.message);
    console.error("❌ Error details:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching coin usage",
    });
  }
};

// Get coin usage for any user (Admin endpoint)
export const getAdminUserCoinUsage = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log("📊 getAdminUserCoinUsage called for userId:", userId);

    // Validate userId
    if (!userId) {
      console.warn("⚠️ No userId provided");
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Convert userId to ObjectId safely
    let userObjectId;
    try {
      userObjectId = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;
      console.log("✅ Converted userId to ObjectId:", userObjectId.toString());
    } catch (err) {
      console.error("❌ Invalid ObjectId conversion:", err.message);
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Get total coins deducted
    let totalDeducted = 0;
    let deductedCount = 0;

    try {
      const deductedTransactions = await CoinTransaction.find({
        userId: userObjectId,
        transactionType: "deducted",
        status: "completed",
      }).lean();

      if (
        Array.isArray(deductedTransactions) &&
        deductedTransactions.length > 0
      ) {
        deductedCount = deductedTransactions.length;
        deductedTransactions.forEach((trans) => {
          if (trans.coinsAmount && typeof trans.coinsAmount === "number") {
            totalDeducted += trans.coinsAmount;
          }
        });
      }
      console.log("💰 Total deducted:", totalDeducted);
    } catch (err) {
      console.error("❌ Error querying deducted transactions:", err.message);
      totalDeducted = 0;
      deductedCount = 0;
    }

    // Get total coins refunded
    let totalRefunded = 0;
    let refundedCount = 0;

    try {
      const refundedTransactions = await CoinTransaction.find(
        {
          userId: userObjectId,
          transactionType: "refunded",
          status: "completed",
        },
        { coinsAmount: 1 },
      );

      if (Array.isArray(refundedTransactions)) {
        refundedCount = refundedTransactions.length;
        refundedTransactions.forEach((trans) => {
          if (trans.coinsAmount && typeof trans.coinsAmount === "number") {
            totalRefunded += trans.coinsAmount;
          }
        });
      }
      console.log("🔄 Total refunded:", totalRefunded);
    } catch (err) {
      console.error("❌ Error querying refunded transactions:", err.message);
      totalRefunded = 0;
      refundedCount = 0;
    }

    const actualUsed = totalDeducted;

    console.log("✅ === ADMIN COIN USAGE SUMMARY ===");
    console.log("   User ID:", userObjectId.toString());
    console.log("   Total Deducted (Total Coins Spent):", totalDeducted);
    console.log("   Total Refunded (Ad Rejections):", totalRefunded);
    console.log("   Actual Used (Total Coins Spent):", actualUsed);

    return res.status(200).json({
      success: true,
      coinsUsed: actualUsed,
      totalDeducted,
      totalRefunded,
      breakdown: {
        deductedTransactions: deductedCount,
        refundedTransactions: refundedCount,
      },
    });
  } catch (error) {
    console.error(
      "❌ Unexpected error in getAdminUserCoinUsage:",
      error.message,
    );
    console.error("❌ Error details:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching coin usage",
    });
  }
};

// ============== UNLIMIT PAYMENT GATEWAY ==============

// Create Unlimit payment link
export const createUnlimitPayment = async (req, res) => {
  try {
    const { amount, currency = "INR" } = req.body;
    const userId = req.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid amount is required",
      });
    }

    if (!UNLIMIT_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "Unlimit payment gateway not configured",
      });
    }

    try {
      const response = await fetch(`${UNLIMIT_BASE_URL}/payment-links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${UNLIMIT_API_KEY}`,
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100), // Convert to smallest currency unit
          currency: currency,
          description: `Buy Coins - User ${userId}`,
          reference_id: `coins_${userId}_${Date.now()}`,
          redirect_url: `${process.env.FRONTEND_URL || "http://localhost:5174"}/profile/coins?status=success`,
          failure_url: `${process.env.FRONTEND_URL || "http://localhost:5174"}/profile/coins?status=failed`,
          metadata: {
            userId: userId,
            type: "coin_purchase",
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to create payment link");
      }

      return res.status(200).json({
        success: true,
        message: "Payment link created successfully",
        paymentLink: data.url || data.id,
        paymentId: data.id,
        reference: data.reference_id,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create Unlimit payment",
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Verify Unlimit payment webhook
export const verifyUnlimitPayment = async (req, res) => {
  try {
    const { paymentId, reference_id, amount, status } = req.body;

    if (!paymentId || !reference_id) {
      return res.status(400).json({
        success: false,
        message: "Payment ID and reference ID required",
      });
    }

    if (!UNLIMIT_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "Unlimit payment gateway not configured",
      });
    }

    // Verify with Unlimit API
    try {
      const response = await fetch(
        `${UNLIMIT_BASE_URL}/payments/${paymentId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${UNLIMIT_API_KEY}`,
          },
        },
      );

      const paymentData = await response.json();

      if (!response.ok) {
        throw new Error("Payment verification failed with Unlimit");
      }

      // Check if payment is successful
      if (
        paymentData.status !== "completed" &&
        paymentData.status !== "succeeded"
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment was not completed",
        });
      }

      // Extract userId from reference_id
      const refId = ensureString(reference_id);
      const parts = refId.split("_");
      const userId = parts.length >= 2 ? parts[1] : "";

      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment reference",
        });
      }

      // Calculate coins with bonus packages
      const coinsData = calculateCoins(paymentData.amount);
      const { coins, bonus, baseCoins, isBonusPackage, amountInRupees } =
        coinsData;

      // Add coins to user
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { coins: coins } },
        { new: true },
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Payment verified and coins added successfully",
        coins: user.coins,
        addedCoins: coins,
        baseCoins,
        bonus,
        isBonusPackage,
        payment: {
          id: paymentId,
          status: paymentData.status,
          amount: paymentData.amount,
          amountInRupees,
        },
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to verify payment with Unlimit",
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
