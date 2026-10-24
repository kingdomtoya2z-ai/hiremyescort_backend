import express from "express";
import {
  getSettings,
  updateWelcomeCoins,
} from "../controllers/settingsController.js";
import { isAdmin, isAuthenticated } from "../middleware/isAuthenticated.js";

const router = express.Router();

router.get("/", isAuthenticated, isAdmin, getSettings);
router.put(
  "/welcome-coins",
  isAuthenticated,
  isAdmin,
  updateWelcomeCoins,
);

export default router;
