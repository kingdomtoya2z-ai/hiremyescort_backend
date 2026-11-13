import mongoose from "mongoose";

/**
 * An identifier that is not allowed to create a new account.
 *
 * Deleting a spam account alone is not enough: the person simply registers
 * again with the same email or phone. A block entry survives the deletion and
 * makes the next registration fail.
 *
 * `value` stores the canonical form - `canonicalEmail` for email and
 * `normalizePhone` for phone - so `John.Doe+spam@gmail.com` cannot slip past a
 * block on `johndoe@gmail.com`.
 */
const blockedIdentitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["email", "phone", "ip"],
      required: true,
    },
    value: { type: String, required: true },
    reason: { type: String, default: "" },
    /** The account this entry was created from, when there is one. */
    sourceUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdBy: { type: String, default: "admin" },
  },
  { timestamps: true },
);

blockedIdentitySchema.index({ type: 1, value: 1 }, { unique: true });
blockedIdentitySchema.index({ createdAt: -1 });

export const BlockedIdentity = mongoose.model(
  "BlockedIdentity",
  blockedIdentitySchema,
);
