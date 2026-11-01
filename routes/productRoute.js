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
  adminUpdateProduct,
} from "../controllers/productController.js";
import { isAdmin, isAuthenticated } from "../middleware/isAuthenticated.js";
import { multipleUpload, runUpload } from "../middleware/multer.js";
import { Product } from "../models/productModel.js";
import { escapeRegex } from "../utils/sanitize.js";
import { stripExpiredAd } from "../utils/adValidation.js";

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
router.put(
  "/admin/update/:adId",
  isAuthenticated,
  isAdmin,
  runUpload(multipleUpload),
  adminUpdateProduct,
);

// User dashboard route
router.get("/user/my-ads", isAuthenticated, getUserAdsForDashboard);

// Filtered search endpoint -
//   /api/v1/product/search?category=call-girls&city=delhi&location=bandra
//   &state=Andhra+Pradesh&adType=free&ageMin=18&ageMax=25&search=model
router.get("/search", async (req, res) => {
  try {
    const {
      category,
      city,
      location,
      state,
      adType,
      ageMin,
      ageMax,
      search,
      hasPhotos,
    } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    /*
     * Public visibility: live approved ads plus expired ones.
     *
     * Expired ads stay searchable so their city/category pages keep their
     * inventory, but the response below strips their photos and contact fields
     * and the sort puts them after every live ad, free ones included.
     */
    const filter = {};
    const andClauses = [
      {
        $or: [
          { status: "approved", isExpired: false },
          { isExpired: true },
          { status: "expired" },
        ],
      },
    ];

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

    /*
     * FILTER 2-3: City and location, anchored.
     *
     * These used to be unanchored regexes, so `city=delhi` also matched
     * "New Delhi", "Delhi Cantt" and anything else merely containing the word -
     * picking Delhi returned other cities' ads, which reads as a filter that
     * does not work. Anchored first, with the loose match kept only as a
     * fallback so a page that only matched loosely before does not go empty.
     */
    const anchored = {};
    const loose = {};
    const toWords = (v) => String(v).toLowerCase().replace(/-/g, " ").trim();

    if (city) {
      const w = toWords(city);
      anchored.city = { $regex: `^${escapeRegex(w)}$`, $options: "i" };
      loose.city = { $regex: escapeRegex(w), $options: "i" };
    }
    if (location) {
      const w = toWords(location);
      anchored.location = { $regex: `^${escapeRegex(w)}$`, $options: "i" };
      loose.location = { $regex: escapeRegex(w), $options: "i" };
    }
    if (state) {
      const w = toWords(state);
      anchored.state = { $regex: `^${escapeRegex(w)}$`, $options: "i" };
      loose.state = { $regex: escapeRegex(w), $options: "i" };
    }
    Object.assign(filter, anchored);

    // FILTER 4: Ad type. The site has premium, golden and free ads, so this is
    // a real narrowing rather than a client-side pass over one page.
    if (adType === "premium" || adType === "golden") {
      filter.adType = String(adType);
    } else if (adType === "free") {
      // Anything with no adType recorded is a free ad.
      andClauses.push({
        $or: [{ adType: "free" }, { adType: { $exists: false } }],
      });
    }

    // FILTER 5: Age band.
    const ageRange = {};
    const lo = Number(ageMin);
    const hi = Number(ageMax);
    if (ageMin != null && ageMin !== "" && Number.isFinite(lo)) {
      ageRange.$gte = lo;
    }
    if (ageMax != null && ageMax !== "" && Number.isFinite(hi)) {
      ageRange.$lte = hi;
    }
    if (Object.keys(ageRange).length) {
      filter.age = ageRange;
    }

    // FILTER 6: Only ads carrying at least one photo. Server-side so the chip
    // narrows the whole result set rather than the dozen already on screen.
    if (String(hasPhotos) === "1") {
      filter.productImg = { $exists: true, $nin: [] };
      // Expired ads are stored with their photos but are served without them,
      // so they cannot satisfy a "has photos" filter.
      andClauses.push({ isExpired: { $ne: true } });
      andClauses.push({ status: { $ne: "expired" } });
    }

    // FILTER 7: Free-text keyword, over the fields a visitor would search.
    const keyword = String(search || "").trim();
    if (keyword) {
      const safe = escapeRegex(keyword);
      const rx = { $regex: safe, $options: "i" };
      andClauses.push({
        $or: [
          { title: rx },
          { about: rx },
          { city: rx },
          { location: rx },
          { state: rx },
        ],
      });
    }

    filter.$and = andClauses;

    /*
     * Execute query (single DB round trip: count + filtered page together).
     *
     * If the anchored city/state/location match finds nothing, retry once with
     * the loose match. That keeps "Delhi" exact where an exact city exists,
     * while a stored name that differs only in punctuation (e.g. "T. Nagar"
     * against the slug "t-nagar") still resolves instead of showing an empty
     * page that used to have results.
     */
    const runSearch = (matchFilter) =>
      Product.aggregate([
        { $match: matchFilter },
        {
          $facet: {
            total: [{ $count: "count" }],
            results: [
          {
            $addFields: {
              // Expired ads come after every live ad, including live free ads.
              expiredSort: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$status", "expired"] },
                      { $eq: ["$isExpired", true] },
                    ],
                  },
                  1,
                  0,
                ],
              },
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
          { $sort: { expiredSort: 1, adTypeSort: 1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $unset: ["adTypeSort", "expiredSort"] },
        ],
      },
    },
      ]);

    let facet = (await runSearch(filter))?.[0] || {};
    let usedLooseMatch = false;

    const anchoredTotal = facet?.total?.[0]?.count ?? 0;
    if (anchoredTotal === 0 && Object.keys(loose).length) {
      const retry = (await runSearch({ ...filter, ...loose }))?.[0] || {};
      if ((retry?.total?.[0]?.count ?? 0) > 0) {
        facet = retry;
        usedLooseMatch = true;
      }
    }

const total = facet?.total?.[0]?.count ?? 0;
const products = (facet?.results ?? []).map(stripExpiredAd);

console.log(
  `[search] category=${category || "-"} state=${state || "-"} city=${city || "-"} location=${location || "-"} adType=${adType || "-"} age=${ageMin || "-"}..${ageMax || "-"} search=${keyword || "-"}${usedLooseMatch ? " (loose match)" : ""} → ${products.length} of ${total} results`,
);

    res.status(200).json({
      success: true,
      products,
      count: products.length,
      total,
      page,
      limit,
      // Tells the client an anchored match found nothing and a looser one was
      // used, so it can avoid presenting the result as an exact city match.
      exactMatch: !usedLooseMatch,
      filters: {
        category,
        state,
        city,
        location,
        adType,
        ageMin,
        ageMax,
        search,
        hasPhotos,
      },
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
