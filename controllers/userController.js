import { User } from "../models/userModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { verifyEmail } from "../emailVerify/verifyEmail.js";
import { Session } from "../models/sessionModel.js";
import { sendOTPMail } from "../emailVerify/sendOTPMail.js";
import cloudinary from "../utils/cloudinary.js";
import { Product } from "../models/productModel.js";
import { setTokenExpiry } from "../utils/tokenManager.js";
import { sendDeleteEmail } from "../emailVerify/sendAdStatusMail.js";
import { ensureString, ensureNumber } from "../utils/sanitize.js";

export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phoneNo } = req.body;
    if (!firstName || !lastName || !email || !password || !phoneNo) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }
    const sanitizedEmail = ensureString(email);
    const user = await User.findOne({ email: sanitizedEmail });
    if (user) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }
    const sanitizedPhone = phoneNo.replace(/\D/g, "");
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
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      firstName,
      lastName,
      email,
      phoneNo: sanitizedPhone,
      password: hashedPassword,
      coins: 1000, // Award 1000 free coins to new users
    });
    const token = jwt.sign({ id: newUser._id }, process.env.SECRET_KEY, {
      expiresIn: "10m",
    });
    newUser.token = token;
    await newUser.save();
    await verifyEmail(token, email); // send email here
    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: newUser,
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

    const sanitizedEmail = ensureString(email);
    const user = await User.findOne({ email: sanitizedEmail });

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

    await verifyEmail(token, email); // send email here

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

    // Check if credentials match admin credentials from .env
    if (
      email === process.env.ADMIN_EMAIL &&
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

    // Regular user login - check database
    const sanitizedEmail = ensureString(email);
    const exisistingUser = await User.findOne({ email: sanitizedEmail });
    if (!exisistingUser) {
      return res.status(400).json({
        success: false,
        message: "User not exist",
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
    const sanitizedEmail = ensureString(email);
    const user = await User.findOne({ email: sanitizedEmail });
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
    await sendOTPMail(otp, email); // send OTP email function

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
    const email = ensureString(req.params.email);
    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is required",
      });
    }
    const user = await User.findOne({ email });
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
    const email = ensureString(req.params.email);
    const user = await User.findOne({ email });
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

    // Find and delete user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
     if (user && user.email){
      try{
        await sendDeleteEmail(user.email)

      }catch(error){ console.error("Failed to send rejection email:", emailError);
        // Continue anyway - don't fail the rejection if email fails
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

    // Delete user from database
    await User.findByIdAndDelete(userId);

    // Delete all user's advertisements
    await Product.deleteMany({ userId });

    // Delete all user sessions
    await Session.deleteMany({ userId });

    return res.status(200).json({
      success: true,
      message: "User and all associated data deleted successfully",
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

    user.coins -= coins;
    await user.save();

    console.log(
      `✅ Deducted ${coins} coins from user ${userId}. New balance: ${user.coins}`,
    );

    return res.status(200).json({
      success: true,
      message: `${coins} coins deducted successfully`,
      remainingCoins: user.coins,
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

    user.coins += coins;
    await user.save();

    console.log(
      `✅ Refunded ${coins} coins to user ${userId}. New balance: ${user.coins}`,
    );

    return res.status(200).json({
      success: true,
      message: `${coins} coins refunded successfully`,
      totalCoins: user.coins,
    });
  } catch (error) {
    console.error("Error refunding coins:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
