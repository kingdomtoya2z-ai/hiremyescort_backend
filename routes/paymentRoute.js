import express from "express";
import {
  getUserCoins,
  getUserCoinUsage,
  getAdminUserCoinUsage,
  createUnlimitPayment,
  verifyUnlimitPayment,
} from "../controllers/paymentController.js";
import { isAuthenticated } from "../middleware/isAuthenticated.js";

const router = express.Router();

// Unlimit payment routes
router.post("/create-payment", isAuthenticated, createUnlimitPayment);
router.post("/verify-payment", isAuthenticated, verifyUnlimitPayment);

// Get coins
router.get("/get-coins", isAuthenticated, getUserCoins);
router.get("/get-used-coins", isAuthenticated, getUserCoinUsage);

// Admin routes
router.get(
  "/admin/user-coin-usage/:userId",
  isAuthenticated,
  getAdminUserCoinUsage,
);

export default router;
