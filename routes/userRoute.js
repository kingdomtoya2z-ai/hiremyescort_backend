import express from "express";
import {
  allUser,
  getLatestUsers,
  changePassword,
  forgotPassword,
  getUserById,
  login,
  logout,
  register,
  reVerify,
  updateUser,
  verify,
  verifyOTP,
  deleteUser,
  deductCoins,
  refundCoins,
  verifyToken,
} from "../controllers/userController.js";
import { isAdmin, isAuthenticated } from "../middleware/isAuthenticated.js";
import { singleUpload } from "../middleware/multer.js";
import {
  loginLimiter,
  registerLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  passwordResetLimiter,
  accountLimiter,
} from "../middleware/rateLimiter.js";

const router = express.Router();

/*
 * Auth throttling.
 *
 * Each action gets its own budget rather than sharing one, so asking for a
 * password reset no longer spends your sign-in attempts. Every credential
 * endpoint is additionally limited per ACCOUNT, because IP limits are invisible
 * to a botnet spreading one attack across thousands of addresses.
 *
 * The account limiters run BEFORE the IP limiters deliberately: the account
 * budget is the stricter of the two in practice, and answering that first
 * avoids spending an IP slot on a request that was going to be refused anyway.
 */

/**
 * `/verify` is limited by IP only: it authenticates with the registration
 * Bearer token rather than an email, so there is no account identifier in the
 * request to key a per-account budget on. The token is itself the credential.
 *
 * For the routes that do take an email it arrives in the body, except
 * /verify-otp/:email and /change-password/:email where it is in the path.
 */
const emailFromBody = (req) => req.body?.email;
const emailFromPath = (req) => req.params?.email;

router.post("/register", registerLimiter, register);
router.post("/verify", otpVerifyLimiter, verify);
router.post("/reverify", accountLimiter("otp-send", emailFromBody), otpSendLimiter, reVerify);
router.post("/login", accountLimiter("login", emailFromBody), loginLimiter, login);
router.post("/forgot-password", accountLimiter("otp-send", emailFromBody), otpSendLimiter, forgotPassword);
router.post(
  "/verify-otp/:email",
  accountLimiter("otp-verify", emailFromPath),
  otpVerifyLimiter,
  verifyOTP,
);
router.post(
  "/change-password/:email",
  accountLimiter("otp-verify", emailFromPath),
  passwordResetLimiter,
  changePassword,
);

/** Deliberately not rate limited: the bearer token is the credential. */
router.post("/logout", isAuthenticated, logout);
router.get("/verify-token", isAuthenticated, verifyToken);

router.get("/all-user", isAuthenticated, isAdmin, allUser);
router.get("/latest-users", isAuthenticated, isAdmin, getLatestUsers);
router.get("/get-user/:userId", getUserById);
router.put("/update/:userId", isAuthenticated, singleUpload, updateUser);
router.delete("/delete-user/:userId", isAuthenticated, isAdmin, deleteUser);
router.put("/deduct-coins/:userId", isAuthenticated, isAdmin, deductCoins);
router.put("/refund-coins/:userId", isAuthenticated, isAdmin, refundCoins);

export default router;
