import { SEO } from "../models/seoModel.js";
import { User } from "../models/userModel.js";

// Update SEO data (handles all levels: category only, category+city, category+city+location)
export const updateSEO = async (req, res) => {
  try {
    const {
      category,
      state,
      city,
      location,
      title,
      description,
      keywords,
      htmlSnippet,
      linkTag,
    } = req.body;
    console.log("updateSEO Request Body:", req.body);
    console.log("updateSEO User:", req.user);

    // Validate: at least category is required
    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    // Build query object based on what fields are provided
    const query = { category };

    // Always include state and city (as empty strings if not provided)
    // IMPORTANT: Normalize to lowercase for consistent matching
    query.state = state ? state.toLowerCase() : "";
    query.city = city ? city.toLowerCase() : "";

    // Validate: if only state or only city is provided, reject
    if ((state && !city) || (!state && city)) {
      return res.status(400).json({
        success: false,
        message: "Both state and city must be provided together, or neither",
      });
    }

    // Always include location (as empty string if not provided)
    query.location = location ? location.toLowerCase() : "";

    // Validate: if location is provided, state and city must also be provided
    if (location && (!state || !city)) {
      return res.status(400).json({
        success: false,
        message: "State and city are required when location is provided",
      });
    }

    console.log("📝 updateSEO Query (normalized):", query);

    // Update or create SEO data
    const updateData = {
      category,
      state: state ? state.toLowerCase() : "",
      city: city ? city.toLowerCase() : "",
      location: location ? location.toLowerCase() : "",
      title,
      description,
      keywords,
      htmlSnippet,
      linkTag,
    };

    console.log("📝 updateSEO Update Data (normalized):", {
      category: updateData.category,
      state: updateData.state || "EMPTY",
      city: updateData.city || "EMPTY",
      location: updateData.location || "EMPTY",
      titleLength: title?.length || 0,
      descriptionLength: description?.length || 0,
    });

    // Only set createdBy if it's a valid ObjectId (not admin string)
    if (req.user._id !== "admin" && req.user._id) {
      updateData.createdBy = req.user._id;
    }

    const seoData = await SEO.findOneAndUpdate(query, updateData, {
      upsert: true,
      new: true,
    });

    console.log("✅ SEO data saved/updated:", {
      _id: seoData._id,
      category: seoData.category,
      state: seoData.state,
      city: seoData.city,
      location: seoData.location,
      title: seoData.title?.substring(0, 50) || "NO TITLE",
    });

    return res.status(200).json({
      success: true,
      message: "SEO data updated successfully",
      seoData,
    });
  } catch (error) {
    console.error("updateSEO error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get SEO data (handles hierarchy: exact match > category+city > category only)
export const getSEO = async (req, res) => {
  try {
    let { category, state, city, location } = req.query;

    // IMPORTANT: Normalize all query parameters to lowercase for consistent matching
    category = category ? category.toLowerCase() : "";
    state = state ? state.toLowerCase() : "";
    city = city ? city.toLowerCase() : "";
    location = location ? location.toLowerCase() : "";

    console.log("🔍 getSEO called with query params (normalized):", {
      category,
      state: state || "EMPTY",
      city: city || "EMPTY",
      location: location || "EMPTY",
    });

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    let seoData = null;

    // Level 1: Try to find exact match (category + state + city + location)
    if (location && state && city) {
      console.log(
        "📍 Level 1: Searching for exact match (category+state+city+location)",
      );
      seoData = await SEO.findOne({
        category,
        state,
        city,
        location,
      });
      console.log("Level 1 result:", seoData ? "FOUND" : "NOT FOUND");
    }

    // Level 2: Try to find category + city match (no location)
    if (!seoData && state && city) {
      console.log(
        "📍 Level 2: Searching for category+state+city (location empty)",
      );
      seoData = await SEO.findOne({
        category,
        state,
        city,
        location: "",
      });
      console.log("Level 2 result:", seoData ? "FOUND" : "NOT FOUND");
      if (seoData) {
        console.log("✅ Match found at Level 2:", {
          category: seoData.category,
          state: seoData.state,
          city: seoData.city,
          title: seoData.title
            ? seoData.title.substring(0, 50) + "..."
            : "NO TITLE",
        });
      }
    }

    // Level 3: Try to find category only match
    if (!seoData) {
      console.log(
        "📍 Level 3: Searching for category-only (state+city+location all empty)",
      );
      seoData = await SEO.findOne({
        category,
        state: "",
        city: "",
        location: "",
      });
      console.log("Level 3 result:", seoData ? "FOUND" : "NOT FOUND");
      if (seoData) {
        console.log("✅ Match found at Level 3 (category-only):", {
          category: seoData.category,
          title: seoData.title
            ? seoData.title.substring(0, 50) + "..."
            : "NO TITLE",
        });
      }
    }

    if (!seoData) {
      console.log("❌ No SEO data found at any level");
      return res.status(200).json({
        success: true,
        message: "No SEO data found",
        seo: {
          title: "",
          description: "",
          keywords: "",
          htmlSnippet: "",
          linkTag: "",
        },
      });
    }

    console.log("📤 Returning SEO data from appropriate level");

    return res.status(200).json({
      success: true,
      seo: {
        title: seoData.title,
        description: seoData.description,
        keywords: seoData.keywords,
        htmlSnippet: seoData.htmlSnippet,
        linkTag: seoData.linkTag,
      },
    });
  } catch (error) {
    console.error("getSEO error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all SEO data (for admin viewing/managing)
export const getAllSEO = async (req, res) => {
  try {
    const seoList = await SEO.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      seoList,
    });
  } catch (error) {
    console.error("getAllSEO error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete SEO data
export const deleteSEO = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await SEO.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "SEO data not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "SEO data deleted successfully",
    });
  } catch (error) {
    console.error("deleteSEO error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
