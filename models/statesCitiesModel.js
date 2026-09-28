import mongoose from "mongoose";

const citieSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  isTopCity: {
    type: Boolean,
    default: false,
  },
  /**
   * Home page tile image, stored as a Cloudinary URL.
   *
   * Required for a city to be shown as a top city: the image is the preview a
   * visitor sees for that city's ads. Toggle it through
   * POST /api/v1/location/admin/toggle-top-city, which uploads the file and
   * writes the resulting URL here.
   */
  image: {
    type: String,
    default: "",
  },
  /** Cloudinary public_id of `image`, so a replacement can destroy the old asset. */
  imagePublicId: {
    type: String,
    default: "",
  },
  locations: [
    {
      name: {
        type: String,
        required: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  seo: {
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
  },
});

const stateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  cities: [citieSchema],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const State = mongoose.model("State", stateSchema);
