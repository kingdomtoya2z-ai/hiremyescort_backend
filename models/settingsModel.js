import mongoose from "mongoose";

/**
 * Platform-wide settings that an admin can change at runtime.
 *
 * A single document is used (keyed by `key`) so reads are a cheap `findOne`
 * rather than a collection scan, and so the whole settings surface can grow
 * without adding another model for every toggle.
 */
export const DEFAULT_WELCOME_COINS = 100;

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "platform",
    },
    /**
     * Coins granted once when a new account is created. Deliberately allows 0,
     * so an admin can switch the registration giveaway off entirely.
     */
    welcomeCoins: {
      type: Number,
      default: DEFAULT_WELCOME_COINS,
      min: 0,
    },
  },
  { timestamps: true },
);

export const Settings = mongoose.model("Settings", settingsSchema);
