import jwt from "jsonwebtoken";
import { Session } from "../models/sessionModel.js";
import { User } from "../models/userModel.js";

// Verify if token is still valid
export const isTokenValid = (token) => {
  try {
    jwt.verify(token, process.env.SECRET_KEY);
    return true;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return false;
    }
    return false;
  }
};

// Decode token to get expiration info
export const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

// Get token expiration time
export const getTokenExpiration = (token) => {
  const decoded = decodeToken(token);
  if (decoded && decoded.exp) {
    return decoded.exp * 1000; // Convert to milliseconds
  }
  return null;
};

// Check if token is expired
export const isTokenExpired = (token) => {
  const expTime = getTokenExpiration(token);
  if (!expTime) return true;
  return Date.now() > expTime;
};

// Cleanup expired sessions and invalid tokens
export const cleanupExpiredTokens = async () => {
  try {
    const now = Date.now();
    const users = await User.find({ isLoggedIn: true });

    for (const user of users) {
      // Check if user's tokens are expired
      if (user.tokenExpiry && new Date(user.tokenExpiry) < new Date()) {
        user.isLoggedIn = false;
        user.tokenExpiry = null;
        await user.save();

        // Delete associated session
        await Session.deleteOne({ userId: user._id });
        console.log(`Token expired and user ${user._id} logged out`);
      }
    }

    // Also cleanup sessions without corresponding users
    await Session.deleteMany({
      createdAt: { $lt: new Date(now - 24 * 60 * 60 * 1000) },
    });

    console.log("✅ Token cleanup completed");
  } catch (error) {
    console.error("❌ Error during token cleanup:", error.message);
  }
};

// Store token expiration time in user document
export const setTokenExpiry = async (userId, token) => {
  try {
    const expTime = getTokenExpiration(token);
    if (expTime) {
      await User.findByIdAndUpdate(userId, {
        tokenExpiry: new Date(expTime),
      });
    }
  } catch (error) {
    console.error("Error setting token expiry:", error.message);
  }
};

export default {
  isTokenValid,
  decodeToken,
  getTokenExpiration,
  isTokenExpired,
  cleanupExpiredTokens,
  setTokenExpiry,
};
