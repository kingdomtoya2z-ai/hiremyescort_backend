import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    profilePic: { type: String, default: "" }, //Cloudinary image URL
    profilePicPublicId: { type: String, default: "" }, //Cloudinary public_id for deletation
    email: { type: String, required: true, unique: true },
    /**
     * Comparison-only form of `email` (see utils/identity.js).
     *
     * Gmail ignores dots and +tags, so this is what the registration duplicate
     * check and the blocklist match on. Kept separate from `email` so the
     * address the user typed is still what they see and what mail is sent to.
     */
    emailCanonical: { type: String, default: "", index: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    token: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    isLoggedIn: { type: Boolean, default: false },
    tokenExpiry: { type: Date, default: null },
    otp: { type: String, default: null },
    otpExpiry: { type: Date, default: null },
    address: { type: String },
    city: { type: String },
    zipCode: { type: String },
    state: { type: String },
    phoneNo: {
      type: String,
      required: true,
      unique: true,
      match: /^[6-9]\d{9}$/,
    },
    coins: { type: Number, default: 0 }, // Coins for premium ads

    /**
     * Registration fingerprints.
     *
     * The IP is the main defence against one person creating a batch of
     * accounts: registration refuses more than `MAX_ACCOUNTS_PER_IP` new
     * accounts from one address inside the configured window. The user agent
     * is recorded for review, not enforcement (it is trivially spoofed).
     */
    signupIp: { type: String, default: "" },
    signupUserAgent: { type: String, default: "" },
    lastLoginIp: { type: String, default: "" },

    /**
     * A banned account cannot log in or use any authenticated endpoint, but
     * unlike a hard delete it stays visible in the admin panel so the history
     * is not lost. Spam accounts are usually hard-deleted after the identifiers
     * are added to the blocklist.
     */
    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    banReason: { type: String, default: "" },
  },
  { timestamps: true },
);

// Sign-up burst detection: "how many accounts came from this IP recently?"
userSchema.index({ signupIp: 1, createdAt: -1 });

export const User = mongoose.model("User", userSchema);
