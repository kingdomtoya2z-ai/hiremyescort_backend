import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    title: { type: String, required: true },
    /**
     * Comparison-only copies of the fields spam detection matches on.
     *
     * The raw values are still what the site displays. These exist so the
     * online duplicate check can use an index instead of loading the whole
     * catalogue and normalising it in JavaScript on every post.
     */
    titleNormalized: { type: String, default: "", index: true },
    whatsapp: { type: String, required: true },
    contact: { type: String, required: true },
    /**
     * Optional Telegram contact. Stored as the user typed it (an @username or a
     * phone number); `telegramNormalized` is the comparison-only copy used by
     * the cross-account spam check. Free ads carry no contact at all.
     */
    telegram: { type: String, default: "" },
    whatsappNormalized: { type: String, default: "", index: true },
    contactNormalized: { type: String, default: "", index: true },
    telegramNormalized: { type: String, default: "", index: true },
    gender: { type: String, required: true },
    services: { type: String, required: true },

    productImg: [
      {
        url: { type: String, required: true },
        public_id: { type: String, required: true },
      },
    ],
    category: { type: String, required: true },
    state: { type: String, required: true },
    city: { type: String, required: true },
    location: { type: String, default: "" },
    age: { type: Number, required: true },
    about: { type: String, required: true },
    terms: { type: String, required: true },
    status: {
      type: String,
      // `expired` is deliberately separate from `rejected`: an expired ad is
      // still publicly searchable (without photos/contact) and belongs in the
      // owner's Renew section, not their Rejected section.
      enum: ["pending", "approved", "rejected", "expired"],
      default: "pending",
    },
    adType: {
      type: String,
      enum: ["free", "golden", "premium"],
      default: "free",
    },
    rejectReason: { type: String, default: "" },
    coinsRefunded: { type: Boolean, default: false },
    approvalDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    isExpired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Compound index for the public search filter + ordering:
// status/isExpired/category narrow the scan, city matches next,
// adType+createdAt give the premium→golden→free sort without a sort stage scan.
productSchema.index({
  status: 1,
  isExpired: 1,
  category: 1,
  city: 1,
  adType: 1,
  createdAt: -1,
});

// Cross-account spam detection. Each lookup is "same value on another live
// ad", so the status/expiry fields come before the value in the index.
productSchema.index({ status: 1, isExpired: 1, titleNormalized: 1 });
productSchema.index({ status: 1, isExpired: 1, contactNormalized: 1 });
productSchema.index({ status: 1, isExpired: 1, whatsappNormalized: 1 });
productSchema.index({ status: 1, isExpired: 1, telegramNormalized: 1 });

export const Product = mongoose.model("Product", productSchema);
