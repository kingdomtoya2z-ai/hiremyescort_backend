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
import { multipleUpload, runUpload } from "../middleware/multer.js";
import { Product } from "../models/productModel.js";
import { escapeRegex } from "../utils/sanitize.js";

const router = express.Router();

router.post("/add", isAuthenticated, runUpload(multipleUpload), addProduct);
router.get("/getallproducts", getAllProduct);
router.delete("/delete/:productId", isAuthenticated, deleteProduct);
router.put(
  "/update/:productId",
  isAuthenticated,
  runUpload(multipleUpload),
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
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

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
    }

    // FILTER 2: City
    if (city) {
      const cityNormalized = city.toLowerCase().replace(/-/g, " ");
      filter.city = { $regex: cityNormalized, $options: "i" };
    }

    // FILTER 3: Location
    if (location) {
      const locationNormalized = location.toLowerCase().replace(/-/g, " ");
      filter.location = { $regex: locationNormalized, $options: "i" };
    }

    // Execute query (single DB round trip: count + filtered page together)
const [facet = {}] = await Product.aggregate([
  { $match: filter },
  {
    $facet: {
      total: [{ $count: "count" }],
      results: [
        {
          $addFields: {
            adTypeSort: {
              $switch: {
                branches: [
                  { case: { $eq: ["$adType", "premium"] }, then: 0 },
                  { case: { $eq: ["$adType", "golden"] }, then: 1 },
                ],
                default: 2,
              },
            },
          },
        },
        { $sort: { adTypeSort: 1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $unset: "adTypeSort" },
      ],
    },
  },
]);

const total = facet?.total?.[0]?.count ?? 0;
const products = facet?.results ?? [];

console.log(
  `[search] category=${category || "-"} city=${city || "-"} location=${location || "-"} → ${products.length} of ${total} results`,
);

    res.status(200).json({
      success: true,
      products,
      count: products.length,
      total,
      page,
      limit,
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
