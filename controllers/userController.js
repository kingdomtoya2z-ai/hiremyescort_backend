import mongoose from "mongoose";
import { User } from "../models/userModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { canonicalEmail, emailLookupFilter, getClientIp } from "../utils/identity.js";
import {
  blockIdentities,
  findBlockedIdentity,
  listBlockedIdentities,
  unblockIdentity,
} from "../utils/blocklist.js";
import {
  MAX_ACCOUNTS_PER_IP,
  SIGNUP_IP_WINDOW_MS,
} from "../utils/abuseLimits.js";
import {
  blockUserIdentities,
  deleteUserCascade,
  destroyProductImages,
} from "../utils/accountCleanup.js";
import { findSpamClusters } from "../services/spamService.js";
import { verifyEmail } from "../emailVerify/verifyEmail.js";
import { Session } from "../models/sessionModel.js";
import { sendOTPMail } from "../emailVerify/sendOTPMail.js";
import cloudinary from "../utils/cloudinary.js";
import { Product } from "../models/productModel.js";
import { setTokenExpiry } from "../utils/tokenManager.js";
import { sendDeleteEmail } from "../emailVerify/sendAdStatusMail.js";
import {
  ensureString,
  ensureNumber,
  isGmailAddress,
} from "../utils/sanitize.js";
import {
  addCoins,
  getBalance,
  spendCoins,
} from "../utils/coinLedger.js";
import { DEFAULT_WELCOME_COINS } from "../models/settingsModel.js";
import { getWelcomeCoins } from "../utils/platformSettings.js";

/**
 * Fallback coins granted once, when an account is created. Admins can change
 * the live value from the dashboard; this is what is used until they do (and
 * if the settings read ever fails). Enough for one golden ad, so a new member
 * can post a paid ad without buying a pack first.
 */
export const NEW_USER_WELCOME_COINS = DEFAULT_WELCOME_COINS;

export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phoneNo } = req.body;
    if (!firstName || !lastName || !email || !password || !phoneNo) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }
    const sanitizedEmail = ensureString(email).trim();
    if (!isGmailAddress(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Only Gmail addresses (@gmail.com) are allowed",
      });
    }
    const emailCanonical = canonicalEmail(sanitizedEmail);

    /*
     * Compare the canonical mailbox, not the raw address.
     *
     * Gmail treats john.doe+spam@gmail.com and johndoe@gmail.com as the same
     * inbox, so the old raw comparison let one person register an unlimited
     * number of accounts from a single email address.
     */
    const user = await User.findOne(emailLookupFilter(sanitizedEmail));
    if (user) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    const sanitizedPhone = ensureString(phoneNo)
      .replace(/\D/g, "")
      .slice(-10);
    if (!/^[6-9]\d{9}$/.test(sanitizedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid Indian phone number (10 digits starting with 6-9)",
      });
    }
    const existingPhone = await User.findOne({ phoneNo: sanitizedPhone });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: "A user with this phone number already exists",
      });
    }

    const ip = getClientIp(req);

    /*
     * A deleted spam account can try again. The blocklist is what turns an
     * account deletion into an actual stop, and it matches the canonical
     * email so a new Gmail alias does not get around it.
     */
    const blocked = await findBlockedIdentity({
      email: sanitizedEmail,
      phone: sanitizedPhone,
      ip,
    });
    if (blocked) {
      return res.status(403).json({
        success: false,
        message:
          "This email, phone number or network is not allowed to create an account. If you believe this is a mistake, please contact support.",
      });
    }

    /*
     * One connection creating a batch of accounts is the signature of the
     * spam pattern. The limit is generous enough for a shared home/office/NAT
     * (see utils/abuseLimits.js) but small enough to stop a registration run.
     */
    if (MAX_ACCOUNTS_PER_IP > 0 && ip) {
      const recentSignups = await User.countDocuments({
        signupIp: ip,
        createdAt: { $gte: new Date(Date.now() - SIGNUP_IP_WINDOW_MS) },
      });
      if (recentSignups >= MAX_ACCOUNTS_PER_IP) {
        return res.status(429).json({
          success: false,
          message:
            "Too many accounts have been created from this network. Please try again later, or contact support if you need help.",
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Read the admin-configured signup bonus at the moment of registration,
    // so a change in the dashboard applies to the very next account.
    const welcomeCoins = await getWelcomeCoins();
    const newUser = await User.create({
      firstName,
      lastName,
      email: sanitizedEmail,
      emailCanonical,
      phoneNo: sanitizedPhone,
      password: hashedPassword,
      coins: welcomeCoins, // one-time welcome coins, granted only at signup
      signupIp: ip,
      signupUserAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    const token = jwt.sign({ id: newUser._id }, process.env.SECRET_KEY, {
      expiresIn: "10m",
    });
    newUser.token = token;
    await newUser.save();
    await verifyEmail(token, sanitizedEmail); // send email here

    // Never return the password hash or the verification/OTP secrets.
    const safeUser = newUser.toObject();
    delete safeUser.password;
    delete safeUser.token;
    delete safeUser.otp;
    delete safeUser.otpExpiry;

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: safeUser,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const verify = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(400).json({
        success: false,
        message: "Authorization token is missing or invalid",
      });
    }
    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.SECRET_KEY);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(400).json({
          success: false,
          message: "The registration token has expired",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Token verification failed",
      });
    }
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }
    user.token = null;
    user.isVerified = true;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const reVerify = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const sanitizedEmail = ensureString(email).trim();
    if (!isGmailAddress(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Only Gmail addresses (@gmail.com) are allowed",
      });
    }
    const user = await User.findOne(emailLookupFilter(sanitizedEmail));

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User with this email not found",
      });
    }

    // Check if user is already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "This email is already verified",
      });
    }

    const token = jwt.sign({ id: user._id }, process.env.SECRET_KEY, {
      expiresIn: "10m",
    });

    user.token = token;
    await user.save();

    await verifyEmail(token, sanitizedEmail); // send email here

    return res.status(200).json({
      success: true,
      message: "Verification email sent successfully",
      token: user.token,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const sanitizedEmail = ensureString(email).trim();

    // Check if credentials match admin credentials from .env
    if (
      sanitizedEmail === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      // Admin login
      const accessToken = jwt.sign(
        { id: "admin", isAdmin: true },
        process.env.SECRET_KEY,
        { expiresIn: "1d" },
      );
      const refreshToken = jwt.sign(
        { id: "admin", isAdmin: true },
        process.env.SECRET_KEY,
        { expiresIn: "7d" },
      );

      return res.status(200).json({
        success: true,
        message: "Welcome back, Admin",
        user: {
          _id: "admin",
          firstName: "Admin",
          lastName: "User",
          email: process.env.ADMIN_EMAIL,
          role: "admin",
          isVerified: true,
        },
        accessToken,
        refreshToken,
      });
    }

    // Only Gmail accounts are allowed on the platform.
    if (!isGmailAddress(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Only Gmail addresses (@gmail.com) are allowed",
      });
    }

    /*
     * Regular user login - check database.
     *
     * The canonical filter also accepts a dot/+tag variant of the address the
     * account was registered with, which is how Gmail users normally type it.
     */
    const exisistingUser = await User.findOne(
      emailLookupFilter(sanitizedEmail),
    );
    if (!exisistingUser) {
      return res.status(400).json({
        success: false,
        message: "User not exist",
      });
    }

    /*
     * A banned account gets the same answer whether or not the password is
     * correct. That avoids turning this endpoint into a password oracle for a
     * suspended account.
     */
    if (exisistingUser.isBanned) {
      return res.status(403).json({
        success: false,
        message: "This account has been suspended. Please contact support.",
      });
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      exisistingUser.password,
    );
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    if (exisistingUser.isVerified === false) {
      return res.status(400).json({
        success: false,
        message: "Verify your account to login",
      });
    }

    // generate token
    const accessToken = jwt.sign(
      { id: exisistingUser._id },
      process.env.SECRET_KEY,
      { expiresIn: "1d" },
    );
    const refreshToken = jwt.sign(
      { id: exisistingUser._id },
      process.env.SECRET_KEY,
      { expiresIn: "7d" },
    );

    exisistingUser.isLoggedIn = true;
    exisistingUser.lastLoginIp = getClientIp(req);
    await setTokenExpiry(exisistingUser._id, accessToken);
    await exisistingUser.save();

    // Check for existing session and delete it
    const existingSession = await Session.findOne({
      userId: exisistingUser._id,
    });
    if (existingSession) {
      await Session.deleteOne({ userId: exisistingUser._id });
    }

    // Create a new session
    await Session.create({ userId: exisistingUser._id });
    return res.status(200).json({
      success: true,
      message: `Welcome back, ${exisistingUser.firstName}`,
      user: exisistingUser,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const logout = async (req, res) => {
  try {
    const userId = req.id;

    // Skip database operations for admin user
    if (userId !== "admin") {
      await Session.deleteMany({ userId: userId });
      await User.findByIdAndUpdate(userId, {
        isLoggedIn: false,
        tokenExpiry: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "User logged out successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const verifyToken = async (req, res) => {
  try {
    // Check if the token is valid (isAuthenticated middleware passed)
    // Additionally, check if the user still exists in the database
    // This handles the case where admin deletes a user - they'll be logged out
    const userId = req.id; // From isAuthenticated middleware

    // Skip user existence check for admin
    if (userId !== "admin") {
      const user = await User.findById(userId);
      if (!user) {
        // User has been deleted, return 401
        return res.status(401).json({
          success: false,
          message: "User no longer exists",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Token is valid",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const sanitizedEmail = ensureString(email).trim();
    if (!isGmailAddress(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Only Gmail addresses (@gmail.com) are allowed",
      });
    }
    const user = await User.findOne(emailLookupFilter(sanitizedEmail));
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    user.otp = otp;
    user.otpExpiry = otpExpiry;

    await user.save();
    await sendOTPMail(otp, sanitizedEmail); // send OTP email function

    return res.status(200).json({
      success: true,
      message: "OTP sent to email successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    const email = ensureString(req.params.email).trim();
    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is required",
      });
    }
    const user = await User.findOne(emailLookupFilter(email));
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }
    if (!user.otp || !user.otpExpiry) {
      return res.status(400).json({
        success: false,
        message: "Otp is not generated or already verified",
      });
    }
    if (user.otpExpiry < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired please request a new one",
      });
    }
    if (otp !== user.otp) {
      return res.status(400).json({
        success: false,
        message: "Otp is invalid",
      });
    }
    user.otp = null;
    user.otpExpiry = null;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const email = ensureString(req.params.email).trim();
    const user = await User.findOne(emailLookupFilter(email));
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password do not match",
      });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const allUser = async (_, res) => {
  try {
    const users = await User.find();
    return res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getLatestUsers = async (req, res) => {
  try {
    const users = await User.find()
      .sort({ createdAt: -1 })
      .select("-password -otp -otpExpiry -token");
    return res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select(
      "-password -otp -otpExpiry -token",
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const userIdToUpdate = req.params.userId; //the ID of the user we want to update
    const loggedInUser = req.user; //from isAuthenticated middleware
    const {
      firstName,
      lastName,
      address,
      city,
      zipCode,
      state,
      phoneNo,
      role,
    } = req.body;

    if (
      loggedInUser._id.toString() !== userIdToUpdate &&
      loggedInUser.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to update this profile",
      });
    }

    let user = await User.findById(userIdToUpdate);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Validate and check phone number uniqueness
    if (phoneNo) {
      const sanitizedPhone = phoneNo.replace(/\D/g, "");
      if (!/^[6-9]\d{9}$/.test(sanitizedPhone)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid Indian phone number (10 digits starting with 6-9)",
        });
      }
      if (sanitizedPhone !== user.phoneNo) {
        const existingPhone = await User.findOne({ phoneNo: sanitizedPhone });
        if (existingPhone) {
          return res.status(400).json({
            success: false,
            message: "A user with this phone number already exists",
          });
        }
      }
      user.phoneNo = sanitizedPhone;
    }

    let profilePicUrl = user.profilePic;
    let profilePicPublicId = user.profilePicPublicId;

    //If a new file is uploaded
    if (req.file) {
      if (profilePicPublicId) {
        await cloudinary.uploader.destroy(profilePicPublicId);
      }

      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "profiles" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );
        stream.end(req.file.buffer);
      });
      profilePicUrl = uploadResult.secure_url;
      profilePicPublicId = uploadResult.public_id;
    }

    //update fields
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.address = address || user.address;
    user.city = city || user.city;
    user.state = state || user.state;
    user.zipCode = zipCode || user.zipCode;
    user.role = role;
    user.profilePic = profilePicUrl;
    user.profilePicPublicId = profilePicPublicId;

    const updatedUser = await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile Updated Successfully",
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find and delete user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    /*
     * Deleting a spam account should also stop the person registering again.
     * That is opt-in here (`?block=true`) because a normal "delete my account"
     * request must not permanently block the user's own email address.
     */
    const shouldBlock =
      String(req.query.block) === "true" || req.body?.block === true;
    const reason =
      ensureString(req.body?.reason).trim() || "Admin deleted account";

    let blocked = 0;
    if (shouldBlock) {
      blocked = (await blockUserIdentities(user, {
        reason,
        createdBy: String(req.id),
      })).length;
    }

    // The deletion itself must not depend on the notification email. If the
    // mail provider is down or misconfigured, log it and keep going.
    if (user.email) {
      try {
        await sendDeleteEmail(user.email);
      } catch (error) {
        console.error("Failed to send deletion email:", error);
      }
    }

    // Delete user's profile picture from cloudinary if exists
    if (user.profilePicPublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePicPublicId);
      } catch (error) {
        console.log("Error deleting profile pic from cloudinary:", error);
      }
    }

    const removed = await deleteUserCascade(userId, { deleteAds: true });

    return res.status(200).json({
      success: true,
      message: "User and all associated data deleted successfully",
      blocked: blocked > 0,
      ...removed,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Delete or ban one spam account and remove its listings.
 *
 * Shared by the single-account and bulk admin endpoints so the two cannot
 * drift: both block the identifiers first, then either hard-delete the account
 * or set `isBanned`, and both remove the ads and their Cloudinary images.
 */
const removeOrBanAccount = async (
  user,
  { reason, hardDelete, deleteAds, block, createdBy },
) => {
  const blocked = block
    ? await blockUserIdentities(user, { reason, createdBy })
    : [];

  if (hardDelete) {
    const removed = await deleteUserCascade(user._id, { deleteAds });
    return {
      userId: String(user._id),
      deleted: true,
      blocked: blocked.length,
      ...removed,
    };
  }

  user.isBanned = true;
  user.bannedAt = new Date();
  user.banReason = reason;
  user.isLoggedIn = false;
  user.token = null;
  user.tokenExpiry = null;
  await user.save();

  await Session.deleteMany({ userId: user._id });

  let adsDeleted = 0;
  let imagesDeleted = 0;

  if (deleteAds) {
    const products = await Product.find({ userId: user._id })
      .select("productImg")
      .lean();
    const imageResult = await destroyProductImages(products);
    adsDeleted = products.length;
    imagesDeleted = imageResult.imagesDeleted;
    await Product.deleteMany({ userId: user._id });
  }

  return {
    userId: String(user._id),
    banned: true,
    blocked: blocked.length,
    adsDeleted,
    imagesDeleted,
  };
};

/**
 * POST /api/v1/user/admin/remove-spam/:userId
 *
 * The admin "remove & block" action. Hard-deletes by default because the goal
 * is to remove the account, but `hardDelete: false` keeps the account in the
 * panel as a banned record.
 */
export const removeSpamUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const {
      reason = "Spam or abusive account",
      hardDelete = true,
      deleteAds = true,
      block = true,
    } = req.body || {};

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role === "admin" || user.email === process.env.ADMIN_EMAIL) {
      return res.status(400).json({
        success: false,
        message: "Admin accounts cannot be removed here.",
      });
    }

    const result = await removeOrBanAccount(user, {
      reason: ensureString(reason).trim() || "Spam or abusive account",
      hardDelete: hardDelete !== false,
      deleteAds: deleteAds !== false,
      block: block !== false,
      createdBy: String(req.id),
    });

    return res.status(200).json({
      success: true,
      message: result.deleted
        ? "Spam account and its ads removed"
        : "Account suspended and its ads removed",
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * POST /api/v1/user/admin/bulk-remove-spam
 * Body: { userIds: [], reason?, hardDelete?, deleteAds?, block? }
 *
 * Capped at 100 accounts per request. Cloudinary deletions are sequential per
 * account, so a very large batch would make the request time out anyway; the
 * admin can send the next page.
 */
export const bulkRemoveSpamUsers = async (req, res) => {
  try {
    const {
      userIds,
      reason = "Spam or abusive accounts",
      hardDelete = true,
      deleteAds = true,
      block = true,
    } = req.body || {};

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one userId",
      });
    }

    if (userIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Remove at most 100 accounts per request.",
      });
    }

    const results = [];
    for (const userId of userIds) {
      if (!mongoose.isValidObjectId(userId)) {
        results.push({ userId, skipped: "invalid id" });
        continue;
      }

      const user = await User.findById(userId);
      if (!user) {
        results.push({ userId, skipped: "not found" });
        continue;
      }

      if (user.role === "admin" || user.email === process.env.ADMIN_EMAIL) {
        results.push({ userId, skipped: "admin account protected" });
        continue;
      }

      try {
        results.push(
          await removeOrBanAccount(user, {
            reason: ensureString(reason).trim() || "Spam or abusive accounts",
            hardDelete: hardDelete !== false,
            deleteAds: deleteAds !== false,
            block: block !== false,
            createdBy: String(req.id),
          }),
        );
      } catch (error) {
        results.push({ userId, error: error.message });
      }
    }

    const deleted = results.filter((result) => result.deleted).length;
    const banned = results.filter((result) => result.banned).length;

    return res.status(200).json({
      success: true,
      message: `${deleted} account${deleted === 1 ? "" : "s"} deleted, ${banned} suspended`,
      deleted,
      banned,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET /api/v1/user/admin/spam-clusters
 *
 * Read-only. Groups accounts that share a phone number, Gmail mailbox,
 * signup IP, ad title or ad contact number. An admin reviews a cluster before
 * anything is removed.
 */
export const getSpamClusters = async (req, res) => {
  try {
    const minUsers = Math.max(Number(req.query.minUsers) || 2, 2);
    const clusters = await findSpamClusters({ minUsers });

    return res.status(200).json({
      success: true,
      count: clusters.length,
      clusters,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/** GET /api/v1/user/admin/blocked-identities */
export const getBlockedIdentities = async (req, res) => {
  try {
    const identities = await listBlockedIdentities({
      type: req.query.type,
      limit: req.query.limit,
      search: req.query.search,
    });

    return res.status(200).json({ success: true, identities });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/** POST /api/v1/user/admin/blocked-identities { type, value, reason } */
export const addBlockedIdentity = async (req, res) => {
  try {
    const { type, value, reason = "" } = req.body || {};

    if (!["email", "phone", "ip"].includes(type) || !value) {
      return res.status(400).json({
        success: false,
        message: "Provide type (email, phone or ip) and a value.",
      });
    }

    const identities = await blockIdentities([{ type, value }], {
      reason: ensureString(reason).trim(),
      createdBy: String(req.id),
    });

    return res.status(201).json({
      success: true,
      message: "Identifier blocked",
      identities,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/** DELETE /api/v1/user/admin/blocked-identities/:id */
export const deleteBlockedIdentity = async (req, res) => {
  try {
    const removed = await unblockIdentity(req.params.id);

    if (!removed) {
      return res.status(404).json({
        success: false,
        message: "Block entry not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Identifier unblocked",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deductCoins = async (req, res) => {
  try {
    const { userId } = req.params;
    const coins = ensureNumber(req.body.coins);

    if (coins <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid coins amount",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.coins < coins) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. User has ${user.coins} coins but ${coins} required`,
      });
    }

    // Atomic: the balance check and the decrement are one operation, so a
    // concurrent ad post cannot spend the same coins between them. The previous
    // `user.coins -= coins; await user.save()` also wrote back the whole stale
    // document, which could silently discard a concurrent deduction.
    const updated = await spendCoins(userId, coins);

    if (!updated) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. User has ${await getBalance(userId)} coins but ${coins} required`,
      });
    }

    console.log(
      `✅ Deducted ${coins} coins from user ${userId}. New balance: ${updated.coins}`,
    );

    return res.status(200).json({
      success: true,
      message: `${coins} coins deducted successfully`,
      remainingCoins: updated.coins,
    });
  } catch (error) {
    console.error("Error deducting coins:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const refundCoins = async (req, res) => {
  try {
    const { userId } = req.params;
    const coins = ensureNumber(req.body.coins);

    if (coins <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid coins amount",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Atomic increment: two admins topping up the same account at once must
    // both land. The previous read-modify-write could silently drop one.
    const updated = await addCoins(userId, coins);

    console.log(
      `✅ Refunded ${coins} coins to user ${userId}. New balance: ${updated.coins}`,
    );

    return res.status(200).json({
      success: true,
      message: `${coins} coins refunded successfully`,
      totalCoins: updated.coins,
    });
  } catch (error) {
    console.error("Error refunding coins:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
