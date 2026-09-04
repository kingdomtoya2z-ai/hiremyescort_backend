import express from "express";
import {
  updateSEO,
  getSEO,
  getAllSEO,
  deleteSEO,
  getSEOByPath,
  getPrerenderHtml,
} from "../controllers/seoController.js";
import { isAuthenticated, isAdmin } from "../middleware/isAuthenticated.js";

const router = express.Router();

// Get SEO data (public)
router.get("/", getSEO);

// Bot/crawler helpers (public) — single source of truth, reads admin DB
router.get("/resolve", getSEOByPath);
router.get("/prerender", getPrerenderHtml);

// Admin routes
router.post("/admin/update", isAuthenticated, isAdmin, updateSEO);
router.get("/admin/all", isAuthenticated, isAdmin, getAllSEO);
router.delete("/admin/:id", isAuthenticated, isAdmin, deleteSEO);

export default router;
