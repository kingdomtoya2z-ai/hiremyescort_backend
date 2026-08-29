import mongoose from "mongoose";

const coinTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    transactionType: {
      type: String,
      enum: ["deducted", "refunded", "purchased"],
      required: true,
    },
    coinsAmount: {
      type: Number,
      required: true,
    },
    adId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    adType: {
      type: String,
      enum: ["free", "golden", "premium"],
      default: "free",
    },
    reason: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["completed", "pending", "failed"],
      default: "completed",
    },
  },
  { timestamps: true },
);

// Index for faster queries
coinTransactionSchema.index({ userId: 1, createdAt: -1 });
coinTransactionSchema.index({ transactionType: 1 });

export const CoinTransaction = mongoose.model(
  "CoinTransaction",
  coinTransactionSchema,
);
