import express from "express";
import {
  updateSEO,
  getSEO,
  getAllSEO,
  deleteSEO,
} from "../controllers/seoController.js";
import { isAuthenticated, isAdmin } from "../middleware/isAuthenticated.js";

const router = express.Router();

// Get SEO data (public)
router.get("/", getSEO);

// Admin routes
router.post("/admin/update", isAuthenticated, isAdmin, updateSEO);
router.get("/admin/all", isAuthenticated, isAdmin, getAllSEO);
router.delete("/admin/:id", isAuthenticated, isAdmin, deleteSEO);

export default router;
