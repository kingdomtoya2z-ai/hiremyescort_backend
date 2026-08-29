import { User } from "../models/userModel.js";
import jwt from "jsonwebtoken";

export const isAuthenticated = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("Auth header:", authHeader);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("Missing or invalid Bearer token");
      return res.status(400).json({
        success: false,
        message: "Authorization token is missing or invalid",
      });
    }
    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.SECRET_KEY);
      console.log("Token verified successfully, decoded:", decoded);
    } catch (error) {
      console.log("Token verification error:", error.message);
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Authorization token has expired",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Access token is missing or invalid",
      });
    }

    // Handle admin user
    if (decoded.isAdmin) {
      req.user = {
        _id: "admin",
        firstName: "Admin",
        lastName: "User",
        email: process.env.ADMIN_EMAIL,
        role: "admin",
        isVerified: true,
      };
      req.id = "admin";
      return next();
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      console.log("User not found or deleted:", decoded.id);
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // Check if token has expired in database
    if (user.tokenExpiry && new Date(user.tokenExpiry) < new Date()) {
      user.isLoggedIn = false;
      user.tokenExpiry = null;
      await user.save();
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please login again.",
      });
    }

    req.user = user;
    req.id = user._id;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const isAdmin = async (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admins only.",
    });
  }
};
