import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema(
  {
    // Scope — same hierarchy as SEO (category required, state+city together, location optional)
    category: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    location: {
      type: String,
      default: "",
    },
    // Banner creative (Cloudinary URL saved after upload)
    imageUrl: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
      default: "",
    },
    // CTA numbers shown under the banner on cityads page
    callNumber: {
      type: String,
      default: "",
    },
    whatsappNumber: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

// One banner per scope — upsert by this key
bannerSchema.index({ category: 1, state: 1, city: 1, location: 1 }, { unique: true });

export const Banner = mongoose.model("Banner", bannerSchema);
