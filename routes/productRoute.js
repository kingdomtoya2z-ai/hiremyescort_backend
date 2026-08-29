import express from "express";
import {
  addProduct,
  deleteProduct,
  getAllProduct,
  updateProduct,
  getAllAdsForAdmin,
  getAdsByUser,
  approveAd,
  rejectAd,
  getUserAdsForDashboard,
} from "../controllers/productController.js";
import { isAdmin, isAuthenticated } from "../middleware/isAuthenticated.js";
import { multipleUpload } from "../middleware/multer.js";
import { Product } from "../models/productModel.js";
import { escapeRegex } from "../utils/sanitize.js";

const router = express.Router();

router.post("/add", isAuthenticated, multipleUpload, addProduct);
router.get("/getallproducts", getAllProduct);
router.delete("/delete/:productId", isAuthenticated, deleteProduct);
router.put(
  "/update/:productId",
  isAuthenticated,
  multipleUpload,
  updateProduct,
);

// Admin routes
router.get("/admin/all-ads", isAuthenticated, isAdmin, getAllAdsForAdmin);
router.get("/admin/user-ads/:userId", isAuthenticated, isAdmin, getAdsByUser);
router.put("/admin/approve/:adId", isAuthenticated, isAdmin, approveAd);
router.put("/admin/reject/:adId", isAuthenticated, isAdmin, rejectAd);

// User dashboard route
router.get("/user/my-ads", isAuthenticated, getUserAdsForDashboard);

// NEW: Filtered search endpoint - /api/v1/product/search?category=call-girls&city=delhi&location=bandra
router.get("/search", async (req, res) => {
  try {
    const { category, city, location } = req.query;

    console.log("\n=== BACKEND SEARCH REQUEST ===");
    console.log("Timestamp:", new Date().toLocaleString());
    console.log("Query params received:", { category, city, location });

    // Build filter object
    const filter = {
      status: "approved",
      isExpired: false,
    };

    // Map category slug to database values
    const categoryMap = {
      "call-girls": ["Call Girls", "Escort"],
      massage: ["Massage"],
      "couple-friendly": ["Couple Friendly"],
    };

    // FILTER 1: Category
    if (category && categoryMap[category]) {
      filter.category = { $in: categoryMap[category] };
      console.log("✓ Category filter applied:", categoryMap[category]);
    } else if (category) {
      console.log("⚠ Category provided but not in map:", category);
    } else {
      console.log("⊙ No category filter (showing all categories)");
    }

    // FILTER 2: City
    if (city) {
      const cityNormalized = city.toLowerCase().replace(/-/g, " ");
      filter.city = { $regex: cityNormalized, $options: "i" };
      console.log("✓ City filter applied for:", cityNormalized);
    } else {
      console.log("⊙ No city filter");
    }

    // FILTER 3: Location
    if (location) {
      const locationNormalized = location.toLowerCase().replace(/-/g, " ");
      filter.location = { $regex: locationNormalized, $options: "i" };
      console.log("✓ Location filter applied for:", locationNormalized);
    } else {
      console.log("⊙ No location filter");
    }

    console.log("Final MongoDB filter:", JSON.stringify(filter, null, 2));

    // Execute query
    const products = await Product.find(filter)
      .sort({ adType: 1, createdAt: -1 })
      .lean();

    console.log("✓ Returned products:", products.length);
    console.log("=== END SEARCH REQUEST ===\n");

    res.status(200).json({
      success: true,
      products,
      count: products.length,
      filters: { category, city, location },
    });
  } catch (error) {
    console.error("[Backend] Search error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/api/v1/product/city/:citySlug", async (req, res) => {
  try {
    const { citySlug } = req.params;
    const city = escapeRegex(citySlug.replace(/-/g, " ").toLowerCase());

    const products = await Product.find({
      $or: [
        { city: { $regex: city, $options: "i" } },
        { location: { $regex: city, $options: "i" } },
      ],
    }).lean();

    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
