import { Banner } from "../models/bannerModel.js";
import cloudinary from "../utils/cloudinary.js";
import getDataUri from "../utils/dataUri.js";

const normalize = (v) => (v ? String(v).trim().toLowerCase() : "");

// Upload / update a banner for a scope (admin). Image -> Cloudinary, URL saved in DB.
export const upsertBanner = async (req, res) => {
  try {
    let { category, state, city, location, callNumber, whatsappNumber } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }

    category = normalize(category);
    state = normalize(state);
    city = normalize(city);
    location = normalize(location);

    // Allowed scopes: category | category+state+city | category+state+city+location
    // (state+city always come together; location needs both)
    if ((state && !city) || (!state && city)) {
      return res.status(400).json({
        success: false,
        message: "Both state and city must be provided together, or neither",
      });
    }
    if (location && (!state || !city)) {
      return res.status(400).json({
        success: false,
        message: "State and city are required when location is provided",
      });
    }

    const query = { category, state, city, location };
    const existing = await Banner.findOne(query);

    // Call + WhatsApp numbers are mandatory
    const effectiveCall = callNumber ? String(callNumber).trim() : existing?.callNumber || "";
    const effectiveWa = whatsappNumber
      ? String(whatsappNumber).trim()
      : existing?.whatsappNumber || "";
    if (!effectiveCall || !effectiveWa) {
      return res.status(400).json({
        success: false,
        message: "Call number and WhatsApp number are required",
      });
    }

    // Handle image upload (field name: "image")
    let imageUrl = existing?.imageUrl || "";
    let public_id = existing?.public_id || "";

    if (req.file) {
      try {
        const fileUri = getDataUri(req.file);
        const result = await cloudinary.uploader.upload(fileUri, {
          folder: "banners",
          quality: "auto",
          fetch_format: "auto",
        });
        // delete old image after successful new upload
        if (existing?.public_id) {
          try {
            await cloudinary.uploader.destroy(existing.public_id);
          } catch (_) {
            // ignore cleanup errors
          }
        }
        imageUrl = result.secure_url;
        public_id = result.public_id;
      } catch (uploadError) {
        console.error("Banner Cloudinary upload error:", uploadError);
        return res.status(500).json({ success: false, message: "Image upload failed" });
      }
    }

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: "Banner image is required" });
    }

    const updateData = {
      category,
      state,
      city,
      location,
      imageUrl,
      public_id,
      callNumber: effectiveCall,
      whatsappNumber: effectiveWa,
    };
    if (req.user?._id && req.user._id !== "admin") {
      updateData.createdBy = req.user._id;
    }

    const banner = await Banner.findOneAndUpdate(query, updateData, {
      upsert: true,
      new: true,
    });

    return res.status(200).json({ success: true, message: "Banner saved successfully", banner });
  } catch (error) {
    console.error("upsertBanner error:", error);
    // duplicate key race
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "Banner already exists for this scope" });
    }
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Public: resolve banner for a scope.
// Priority: exact location > city > category-only.
// A more specific banner shields its scope from broader ones
// (e.g. a location banner wins over the city banner for that location).
export const getBanner = async (req, res) => {
  try {
    let { category, state, city, location } = req.query;
    category = normalize(category);
    state = normalize(state);
    city = normalize(city);
    location = normalize(location);

    if (!category) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }

    let banner = null;

    if (location && state && city) {
      banner = await Banner.findOne({ category, state, city, location });
    }
    if (!banner && state && city) {
      banner = await Banner.findOne({ category, state, city, location: "" });
    }
    if (!banner) {
      banner = await Banner.findOne({ category, state: "", city: "", location: "" });
    }

    return res.status(200).json({ success: true, banner });
  } catch (error) {
    console.error("getBanner error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Admin: list all banners
export const getAllBanners = async (_req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, banners });
  } catch (error) {
    console.error("getAllBanners error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Admin: delete a banner (also removes Cloudinary image)
export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);
    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }
    if (banner.public_id) {
      try {
        await cloudinary.uploader.destroy(banner.public_id);
      } catch (_) {
        // ignore cleanup errors
      }
    }
    await Banner.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: "Banner deleted successfully" });
  } catch (error) {
    console.error("deleteBanner error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
