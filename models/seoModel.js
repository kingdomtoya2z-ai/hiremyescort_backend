import mongoose from "mongoose";

const seoSchema = new mongoose.Schema(
  {
    // Level 1: Category only
    category: {
      type: String,
      required: true,
    },
    // Level 2: Category + State + City
    state: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    // Level 3: Category + State + City + Location
    location: {
      type: String,
      default: "",
    },
    // SEO Data
    title: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    keywords: {
      type: String,
      default: "",
    },
    htmlSnippet: {
      type: String,
      default: "",
    },
    linkTag: {
      type: String,
      default: "",
    },
    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

// Compound index for efficient queries
seoSchema.index({ category: 1, state: 1, city: 1, location: 1 });
seoSchema.index({ category: 1 });
seoSchema.index({ category: 1, state: 1, city: 1 });

export const SEO = mongoose.model("SEO", seoSchema);
