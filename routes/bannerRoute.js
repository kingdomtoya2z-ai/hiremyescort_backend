import express from "express";
import {
  upsertBanner,
  getBanner,
  getAllBanners,
  deleteBanner,
} from "../controllers/bannerController.js";
import { isAuthenticated, isAdmin } from "../middleware/isAuthenticated.js";
import { bannerUpload } from "../middleware/multer.js";

const router = express.Router();

// Public — resolve banner for a scope
router.get("/", getBanner);

// Admin
router.post("/admin/upsert", isAuthenticated, isAdmin, bannerUpload, upsertBanner);
router.get("/admin/all", isAuthenticated, isAdmin, getAllBanners);
router.delete("/admin/:id", isAuthenticated, isAdmin, deleteBanner);

export default router;
