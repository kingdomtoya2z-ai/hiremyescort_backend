import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    title: { type: String, required: true },
    whatsapp: { type: String, required: true },
    contact: { type: String, required: true },
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
      enum: ["pending", "approved", "rejected"],
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

export const Product = mongoose.model("Product", productSchema);
