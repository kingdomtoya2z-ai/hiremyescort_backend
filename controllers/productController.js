import { Product } from "../models/productModel.js";
import { User } from "../models/userModel.js";
import { CoinTransaction } from "../models/coinTransactionModel.js";
import cloudinary from "../utils/cloudinary.js";
import getDataUri from "../utils/dataUri.js";
import {
  addCoins,
  getBalance,
  insufficientCoinsMessage,
  spendCoins,
} from "../utils/coinLedger.js";
import {
  FREE_AD_LIMIT,
  DUPLICATE_MESSAGE,
  allowsContact,
  countActiveFreeAds,
  findDuplicateAd,
  getMaxImagesForAdType,
  normalizeAdType,
  validateAdText,
  calculateExpiryDate,
} from "../utils/adValidation.js";

import {
  sendAdApprovalMail,
  sendAdRejectionMail,
} from "../emailVerify/sendAdStatusMail.js";

export const addProduct = async (req, res) => {
  try {
    console.log("📥 addProduct called");
    console.log("Body:", req.body);
    console.log("Files:", req.files ? `${req.files.length} files` : "no files");
    console.log("User ID:", req.id);

    let {
      title,
      whatsapp,
      contact,
      gender,
      services,
      category,
      state,
      city,
      location,
      age,
      about,
      terms,
      adType = "free",
    } = req.body;

    // Convert age to number
    age = parseInt(age);

    const userId = req.id;

    // Check if user has phone number set
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    if (!user.phoneNo) {
      return res.status(400).json({
        success: false,
        message: "Please set your phone number in your profile before posting an ad",
        requiresPhoneSetup: true,
      });
    }

    // Normalize category: frontend sends slugs, convert to proper database format
    const categoryMap = {
      "call-girls": "Call Girls",
      massage: "Massage",
      "couple-friendly": "Couple Friendly",
    };

    if (categoryMap[category]) {
      category = categoryMap[category];
      console.log("📝 Normalized category to:", category);
    }

    console.log(
      "📋 Extracted fields - title:",
      title,
      "adType:",
      adType,
      "age:",
      age,
    );

    if (
      !title ||
      !whatsapp ||
      !contact ||
      !gender ||
      !services ||
      !category ||
      !state ||
      !city ||
      !age ||
      !about ||
      !terms
    ) {
      console.log("❌ Missing required fields");
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Title/description rules: max length + no numbers allowed
    const textError = validateAdText({ title, about });
    if (textError) {
      return res.status(400).json({ success: false, message: textError });
    }

    // Only premium ads carry contact details. Free and golden drop them here so
    // the numbers are never written to the database, rather than being stored
    // and merely hidden in the UI.
    adType = normalizeAdType(adType);
    if (!allowsContact(adType)) {
      whatsapp = "";
      contact = "";
    }

    // One account cannot run the same ad twice.
    const duplicate = await findDuplicateAd(userId, { title, about });
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: DUPLICATE_MESSAGE,
        duplicateReason: duplicate.reason,
      });
    }

    // Coin costs for ad types
    const coinCosts = {
      free: 0,
      golden: 100,
      premium: 200,
    };

    const coinsNeeded = coinCosts[adType] || 0;

    // Free ads: a user can have at most FREE_AD_LIMIT at once
    if (adType === "free") {
      const freeCount = await countActiveFreeAds(userId);
      if (freeCount >= FREE_AD_LIMIT) {
        return res.status(400).json({
          success: false,
          message: `You can only have ${FREE_AD_LIMIT} free ad. Please delete or upgrade your existing free ad before posting another.`,
        });
      }
    }

    // Image limit by ad type (free=0, golden=2, premium=4)
    const maxImages = getMaxImagesForAdType(adType);
    if (req.files && req.files.length > maxImages) {
      return res.status(400).json({
        success: false,
        message:
          maxImages === 0
            ? `Free ads cannot include photos. Remove the image${req.files.length > 1 ? "s" : ""} and post again.`
            : `Maximum ${maxImages} image${maxImages > 1 ? "s" : ""} allowed for ${adType} ads.`,
      });
    }

    /*
     * Advisory pre-check only, for a fast, friendly error before any upload.
     * It is NOT the guard: between here and the deduction below sits the whole
     * Cloudinary round-trip, so this value is already stale by the time it
     * would matter. spendCoins is what actually prevents an overdraft.
     */
    if (adType !== "free" && user.coins < coinsNeeded) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. You need ${coinsNeeded} coins for a ${adType} ad. You have ${user.coins} coins.`,
      });
    }

    // Handle multiple image uploads FIRST (before deducting coins)
    console.log("📸 Processing", req.files?.length || 0, "images");

    let productImg = [];

    if (req.files && req.files.length > 0) {
      for (let file of req.files) {
        try {
          console.log("⬆️ Uploading file:", file.originalname);

          const fileUri = getDataUri(file);

          const result = await cloudinary.uploader.upload(fileUri, {
            folder: "mern_products",

            quality: "auto",
            fetch_format: "auto",

            transformation: [
              // BASE IMAGE SIZE
              {
                width: 500,
                height: 500,
                crop: "fill",
                gravity: "auto",
              },

              // ✅ CENTER BIG WATERMARK
              {
                overlay: "watermark",
                flags: "relative",
                width: "0.6", // 60% of image width (adjust if needed)
                crop: "scale",
                gravity: "center",
                opacity: 50, // adjust visibility
              },
            ],
          });

          console.log("✅ Uploaded:", result.secure_url);

          productImg.push({
            url: result.secure_url,
            public_id: result.public_id,
          });
        } catch (uploadError) {
          console.error("❌ Cloudinary upload error:", uploadError);
          throw uploadError;
        }
      }
    }
    /**
     * NOW deduct coins, after the images are safely uploaded.
     *
     * `spendCoins` performs the affordability check and the decrement in one
     * atomic update. The earlier check was advisory only — it cannot be the real
     * guard, because it runs before the upload above, so for the whole duration
     * of the Cloudinary round-trip another request can spend the same coins.
     * Two requests arriving together used to both pass that check and both
     * deduct, which is how an account ends up at a negative balance holding an
     * ad it never paid for.
     */
    let updatedUser = null;
    if (adType !== "free" && coinsNeeded > 0) {
      updatedUser = await spendCoins(userId, coinsNeeded);

      if (!updatedUser) {
        // Lost the race (or the balance was never there). Do not create the ad,
        // and do not leave the images we just uploaded orphaned in Cloudinary.
        await Promise.all(
          productImg.map((img) =>
            cloudinary.uploader
              .destroy(img.public_id)
              .catch((err) =>
                console.error("Cloudinary cleanup error:", err.message),
              ),
          ),
        );

        const coins = await getBalance(userId);
        return res.status(400).json({
          success: false,
          message: insufficientCoinsMessage(coinsNeeded, coins, adType),
        });
      }

      // Send email to user about coin deduction
    }

    // create a product in DB
    console.log("💾 Creating product in database");
    const newProduct = await Product.create({
      userId,
      title,
      whatsapp,
      contact,
      gender,
      services,
      category,
      state,
      city,
      location,
      age,
      about,
      terms,
      adType,
      productImg,
    });

    // Save coin transaction record if coins were deducted
    if (adType !== "free" && coinsNeeded > 0) {
      console.log("💳 Creating CoinTransaction record for new ad:");
      console.log("   - userId:", userId, "(type:", typeof userId, ")");
      console.log("   - coinsAmount:", coinsNeeded);
      console.log("   - adType:", adType);
      console.log("   - adId:", newProduct._id);

      try {
        const transaction = await CoinTransaction.create({
          userId,
          transactionType: "deducted",
          coinsAmount: coinsNeeded,
          adId: newProduct._id,
          adType: adType,
          reason: `Coins deducted for ${adType} advertisement "${title}"`,
          status: "completed",
        });
        // Ensure record is persisted
        await transaction.save();
        console.log("✅ CoinTransaction saved successfully");
        console.log("   - Transaction ID:", transaction._id);
        console.log(
          "   - Stored userId:",
          transaction.userId,
          "(type:",
          typeof transaction.userId,
          ")",
        );
        console.log("   - Stored amount:", transaction.coinsAmount);
      } catch (txnError) {
        console.error("❌ Error creating coin transaction:", txnError.message);
        console.error("❌ Error details:", txnError);
        // Don't fail the entire process
      }
    }

    console.log("✅ Product created:", newProduct._id);

    // Fetch current user coins to return in response
    const userWithCoins = await User.findById(userId).select("coins");
    const currentCoins = userWithCoins?.coins || 0;

    return res.status(200).json({
      success: true,
      message: "Advertisement added successfully",
      product: newProduct,
      coins: currentCoins,
    });
  } catch (error) {
    console.error("❌ addProduct error:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Full error object:", JSON.stringify(error, null, 2));

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to add advertisement",
      errorType: error.name,
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getAllProduct = async (_, res) => {
  try {
    // Fetch only approved products WITH expiry dates that are not expired
    // This excludes old ads posted before the expiry system was implemented
    const products = await Product.find({
      status: "approved",
      isExpired: false,
      approvalDate: { $ne: null, $exists: true },
      expiryDate: { $ne: null, $exists: true },
    })
      .lean()
      .exec();

    if (!products || products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No advertisement available",
        products: [],
      });
    }

    // Sort products by type (premium -> golden -> free) then by creation date
    const typeOrder = { premium: 0, golden: 1, free: 2 };
    products.sort((a, b) => {
      const typeA = typeOrder[a.adType] !== undefined ? typeOrder[a.adType] : 2;
      const typeB = typeOrder[b.adType] !== undefined ? typeOrder[b.adType] : 2;

      if (typeA !== typeB) {
        return typeA - typeB;
      }
      // If same type, sort by newest first
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return res.status(200).json({
      success: true,
      products,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.id;
    const userRole = req.user?.role;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check ownership - only owner or admin can delete
    const isOwner = product.userId.toString() === userId.toString();
    const isAdmin = userRole === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete this product",
      });
    }

    // Delete images from cloudinary
    if (product.productImg && product.productImg.length > 0) {
      for (let img of product.productImg) {
        const result = await cloudinary.uploader.destroy(img.public_id);
      }
    }

    // Delete product from MongoDB
    await Product.findByIdAndDelete(productId);
    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const {
      title,
      whatsapp,
      contact,
      gender,
      services,
      category,
      state,
      city,
      location,
      age,
      about,
      terms,
      adType,
      existingImages,
    } = req.body;

    const userId = req.id;
    const userRole = req.user?.role;

    // Check if user has phone number set
    const userForPhone = await User.findById(userId);
    if (!userForPhone) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    if (!userForPhone.phoneNo) {
      return res.status(400).json({
        success: false,
        message: "Please set your phone number in your profile before updating an ad",
        requiresPhoneSetup: true,
      });
    }

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ---------------------------
    // AUTH CHECK
    // ---------------------------
    const isOwner = product.userId.toString() === userId.toString();
    const isAdmin = userRole === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this product",
      });
    }

    // Title/description rules: max length + no numbers allowed
    const textError = validateAdText({ title, about });
    if (textError) {
      return res.status(400).json({ success: false, message: textError });
    }

    // Target ad type (final type after this update)
    const newAdType = normalizeAdType(adType ?? product.adType);

    // Only premium ads keep contact details, so downgrading a premium ad to
    // free or golden clears the numbers rather than leaving them stored on a
    // page that no longer renders them.
    const keepsContact = allowsContact(newAdType);
    const nextWhatsapp = keepsContact ? (whatsapp ?? product.whatsapp) : "";
    const nextContact = keepsContact ? (contact ?? product.contact) : "";

    // The same duplicate rule as posting, ignoring this ad's own row.
    const duplicate = await findDuplicateAd(
      product.userId,
      { title: title ?? product.title, about: about ?? product.about },
      productId,
    );
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: DUPLICATE_MESSAGE,
        duplicateReason: duplicate.reason,
      });
    }

    // Free ads: a user can have at most FREE_AD_LIMIT at once (excluding this ad)
    if (newAdType === "free") {
      const freeCount = await countActiveFreeAds(userId, productId);
      if (freeCount >= FREE_AD_LIMIT) {
        return res.status(400).json({
          success: false,
          message: `You can only have ${FREE_AD_LIMIT} free ad. Please delete or upgrade one of your existing free ads before switching this ad to free.`,
        });
      }
    }

    // Image limit by target ad type (free=0, golden=2, premium=4)
    const maxImages = getMaxImagesForAdType(newAdType);
    const imageLimitMessage = (kept, adding) =>
      maxImages === 0
        ? `${newAdType === "free" ? "Free" : newAdType} ads cannot include photos. Remove the photo${kept + adding > 1 ? "s" : ""} and save again.`
        : `Maximum ${maxImages} image${maxImages > 1 ? "s" : ""} allowed for ${newAdType} ads${kept + adding > 0 ? ` (you have ${kept} saved and are adding ${adding})` : ""}.`;

    const incomingFiles = req.files?.length || 0;
    if (incomingFiles > maxImages) {
      return res.status(400).json({
        success: false,
        message: imageLimitMessage(0, incomingFiles),
      });
    }

    // ---------------------------
    // SAFE IMAGE ARRAY
    // ---------------------------
    let updatedImages = Array.isArray(product.productImg)
      ? [...product.productImg]
      : [];

    // Parse which existing images to keep BEFORE deleting anything, so the
    // total image count can be validated without destroying cloudinary files.
    let keepIds = [];
    if (existingImages) {
      try {
        keepIds = JSON.parse(existingImages);
        if (!Array.isArray(keepIds)) keepIds = [];
      } catch (err) {
        console.error("❌ existingImages parse error:", err.message);
        keepIds = [];
      }
    }

    // A free ad carries no photos, so downgrading one drops whatever it had
    // instead of failing the save with "free ads cannot include photos" on the
    // user's own earlier images.
    if (maxImages === 0) {
      keepIds = [];
    }

    const keptImages = updatedImages.filter((img) =>
      keepIds.includes(img.public_id),
    );

    if (keptImages.length + incomingFiles > maxImages) {
      return res.status(400).json({
        success: false,
        message: imageLimitMessage(keptImages.length, incomingFiles),
      });
    }

    // Safe to proceed: remove images the user dropped, then append new uploads
    const removeImages = updatedImages.filter(
      (img) => !keepIds.includes(img.public_id),
    );
    updatedImages = keptImages;

    for (let img of removeImages) {
      try {
        await cloudinary.uploader.destroy(img.public_id);
      } catch (err) {
        console.error("❌ Cloudinary delete error:", err.message);
      }
    }

    // ---------------------------
    // UPLOAD NEW IMAGES (WITH IMAGE WATERMARK)
    // ---------------------------
    if (req.files && req.files.length > 0) {
      for (let file of req.files) {
        try {
          const fileUri = getDataUri(file);

          const result = await cloudinary.uploader.upload(fileUri, {
            folder: "mern_products",
            quality: "auto",
            fetch_format: "auto",

            transformation: [
              // BASE IMAGE
              {
                width: 500,
                height: 500,
                crop: "fill",
                gravity: "auto",
              },

              // ---------------------------
              // IMAGE WATERMARK (CENTER)
              // ---------------------------
              {
                overlay: "watermark", // MUST EXIST in Cloudinary
                flags: "relative",
                width: "0.6", // 60% width watermark
                crop: "scale",
                gravity: "center",
                opacity: 40,
              },
            ],
          });

          updatedImages.push({
            url: result.secure_url,
            public_id: result.public_id,
          });
        } catch (err) {
          console.error("❌ Cloudinary upload failed:", err.message);
        }
      }
    }

    // Coin costs for ad types
    const coinCosts = {
      free: 0,
      golden: 100,
      premium: 200,
    };

    // newAdType is computed earlier (used for image/quota validation)
    const coinsNeeded = coinCosts[newAdType] || 0;

    // Check if user has enough coins for paid ads when resubmitting
    let updatedUser = null;
    if (newAdType !== "free" && coinsNeeded > 0) {
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.coins < coinsNeeded) {
        return res.status(400).json({
          success: false,
          message: `Insufficient coins. You need ${coinsNeeded} coins for a ${newAdType} ad. You have ${user.coins} coins.`,
        });
      }

      // Deduct coins for resubmission. Atomic, so two concurrent edits cannot
      // both spend the same balance.
      updatedUser = await spendCoins(userId, coinsNeeded);

      if (!updatedUser) {
        return res.status(400).json({
          success: false,
          message: insufficientCoinsMessage(
            coinsNeeded,
            await getBalance(userId),
            newAdType,
          ),
        });
      }

      console.log(
        `💳 Deducted ${coinsNeeded} coins for ${newAdType} ad resubmission. New balance: ${updatedUser.coins}`,
      );

      // Create coin transaction record
      try {
        await CoinTransaction.create({
          userId,
          transactionType: "deducted",
          coinsAmount: coinsNeeded,
          adId: productId,
          adType: newAdType,
          reason: `Coins deducted for ${newAdType} advertisement resubmission "${title ?? product.title}"`,
          status: "completed",
        });
        console.log("✅ CoinTransaction created for resubmission");
      } catch (txnError) {
        console.error("❌ Error creating coin transaction:", txnError.message);
        // Don't fail the update if transaction logging fails
      }
    }

    // ---------------------------
    // UPDATE FIELDS
    // ---------------------------
    product.title = title ?? product.title;
    product.whatsapp = nextWhatsapp;
    product.contact = nextContact;
    product.gender = gender ?? product.gender;
    product.services = services ?? product.services;

    // Normalize category before saving
    let normalizedCategory = category;
    if (category) {
      const categoryMap = {
        "call-girls": "Call Girls",
        massage: "Massage",
        "couple-friendly": "Couple Friendly",
      };
      if (categoryMap[category]) {
        normalizedCategory = categoryMap[category];
      }
    }
    product.category = normalizedCategory ?? product.category;

    product.state = state ?? product.state;
    product.city = city ?? product.city;
    product.location = location ?? product.location;
    product.age = age ?? product.age;
    product.about = about ?? product.about;
    product.terms = terms ?? product.terms;
    product.adType = newAdType;
    product.productImg = updatedImages;

    product.status = "pending";

    await product.save();

    // ---------------------------
    // USER COINS
    // ---------------------------
    if (!updatedUser) {
      updatedUser = await User.findById(userId).select("coins");
    }

    return res.status(200).json({
      success: true,
      message:
        coinsNeeded > 0
          ? `Product updated successfully and ${coinsNeeded} coins deducted for resubmission`
          : "Product updated successfully",
      product,
      coins: updatedUser?.coins || 0,
      coinsDeducted: coinsNeeded,
    });
  } catch (error) {
    console.error("🔥 UPDATE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

// Admin functions
export const getAllAdsForAdmin = async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;

    // Build a filter so the admin can request only what they need
    // (e.g. ?status=pending) instead of always downloading every ad.
    const filter = {};
    if (status) {
      filter.status = status;
    }
    if (search) {
      const safeSearch = String(search).trim();
      if (safeSearch) {
        filter.$or = [
          { title: { $regex: safeSearch, $options: "i" } },
          { city: { $regex: safeSearch, $options: "i" } },
          { state: { $regex: safeSearch, $options: "i" } },
          { location: { $regex: safeSearch, $options: "i" } },
          { category: { $regex: safeSearch, $options: "i" } },
        ];
      }
    }

    let query = Product.find(filter).populate({
      path: "userId",
      select: "firstName lastName email phoneNo city state",
    });

    // Optional pagination (used by the dashboard's live-updating sections)
    const parsedPage = Math.max(Number(page) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const hasPagination = page !== undefined || limit !== undefined;

    if (hasPagination) {
      const skip = (parsedPage - 1) * parsedLimit;
      const [totalCount, ads] = await Promise.all([
        Product.countDocuments(filter),
        query.sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
      ]);
      return res.status(200).json({
        success: true,
        message: "Advertisements fetched",
        ads,
        total: totalCount,
        page: parsedPage,
        limit: parsedLimit,
      });
    }

    const ads = await query.sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      message: "All advertisements fetched",
      ads,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAdsByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const userAds = await Product.find({ userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "User advertisements fetched",
      ads: userAds,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const approveAd = async (req, res) => {
  try {
    const { adId } = req.params;

    // Fetch the ad to check its current status and type
    const ad = await Product.findById(adId);
    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Advertisement not found",
      });
    }

    // Coin costs for ad types
    const coinCosts = {
      free: 0,
      golden: 100,
      premium: 200,
    };

    // If re-approving a rejected ad, deduct coins
    const isReApproval = ad.status === "rejected";
    const requiredCoins = isReApproval ? coinCosts[ad.adType] || 0 : 0;

    if (isReApproval && requiredCoins > 0) {
      // Fetch user to check coin balance
      const user = await User.findById(ad.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if user has enough coins
      if (user.coins < requiredCoins) {
        return res.status(400).json({
          success: false,
          message: `Insufficient coins. User has ${user.coins} coins but ${requiredCoins} required to re-approve this ${ad.adType} ad`,
          userCoins: user.coins,
          requiredCoins: requiredCoins,
        });
      }

      // Deduct coins from user.
      //
      // This used to be `user.coins -= requiredCoins; await user.save()`, which
      // is worse than a plain race: save() writes the WHOLE document as it was
      // read, so a concurrent $inc from a new ad can be silently overwritten and
      // the deduction lost — which then lets the user keep spending coins they no
      // longer have. The atomic conditional update cannot lose an update.
      const charged = await spendCoins(ad.userId, requiredCoins);

      if (!charged) {
        return res.status(400).json({
          success: false,
          message: `Insufficient coins. User has ${await getBalance(ad.userId)} coins but ${requiredCoins} required to re-approve this ${ad.adType} ad`,
          userCoins: await getBalance(ad.userId),
          requiredCoins: requiredCoins,
        });
      }

      console.log(
        `✅ Deducted ${requiredCoins} coins from user ${ad.userId} on re-approval. New balance: ${charged.coins}`,
      );
    }

    // Expiry is measured from approval, using the shared per-type window
    // (free 24 hours, golden 4 days, premium 1 week) rather than a local copy
    // that could drift from the expiry checker's.
    const approvalDate = new Date();
    const expiryDate = calculateExpiryDate(ad.adType, approvalDate);

    // Update ad status
    const updatedAd = await Product.findByIdAndUpdate(
      adId,
      {
        status: "approved",
        rejectReason: "",
        approvalDate: approvalDate,
        expiryDate: expiryDate,
        isExpired: false,
      },
      { new: true },
    );

    // Fetch user details to get email
    const user = await User.findById(ad.userId);
    if (user && user.email) {
      try {
        const message = isReApproval
          ? `Your advertisement "${ad.title}" has been re-approved after rejection.`
          : `Your advertisement "${ad.title}" has been approved.`;
        await sendAdApprovalMail(user.email, ad.title, ad._id.toString());
      } catch (emailError) {
        console.error("Failed to send approval email:", emailError);
        // Continue anyway - don't fail the approval if email fails
      }
    }

    return res.status(200).json({
      success: true,
      message: isReApproval
        ? `Advertisement re-approved successfully and ${requiredCoins} coins deducted`
        : "Advertisement approved successfully",
      ad: updatedAd,
      coinsDeducted: requiredCoins,
    });
  } catch (error) {
    console.error("Error in approveAd:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const rejectAd = async (req, res) => {
  try {
    const { adId } = req.params;
    const { reason } = req.body;

    // Fetch the ad first to check if it's a paid ad
    const ad = await Product.findById(adId);
    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Advertisement not found",
      });
    }

    // Check if this ad has already been rejected with refund
    if (ad.status === "rejected" && ad.coinsRefunded) {
      // Ad already rejected and coins already refunded, no need to refund again
      return res.status(200).json({
        success: true,
        message:
          "Advertisement already rejected. Coins were previously refunded.",
        ad: ad,
        refundedCoins: 0,
      });
    }

    /*
     * An ad that ran out its validity period is NEVER refundable.
     *
     * The expiry job moves ads to `rejected` but deliberately does not refund -
     * the coins were spent on a month of visibility that was used. It leaves
     * `coinsRefunded` false, because nothing was refunded.
     *
     * That made the guard above a hole: it only short-circuits when
     * `coinsRefunded` is true, so calling this endpoint on an expired ad fell
     * straight through and paid out. There are 1,312 such ads in the database
     * right now, so any of them could be refunded - by an admin clicking reject
     * on an ad they thought was still live, or by anyone who can reach this
     * endpoint.
     *
     * Rejecting an expired ad is still allowed - an admin may want to record a
     * reason - it just cannot move coins.
     */
    if (ad.isExpired) {
      const updatedExpiredAd = await Product.findByIdAndUpdate(
        adId,
        {
          status: "rejected",
          isExpired: true,
          coinsRefunded: false,
          ...(reason ? { rejectReason: reason } : {}),
        },
        { new: true },
      );

      return res.status(200).json({
        success: true,
        message:
          "Advertisement had already expired. No coins were refunded - expiry is not a refundable event.",
        ad: updatedExpiredAd,
        refundedCoins: 0,
      });
    }

    // Refund coins if ad is paid (golden or premium)
    const coinCosts = {
      free: 0,
      golden: 100,
      premium: 200,
    };

    const refundAmount = coinCosts[ad.adType] || 0;
    let updatedUser = null;
    let refundedAmount = 0;

    if (refundAmount > 0) {
      // Refund coins to user. Atomic so a concurrent deduction is not clobbered
      // by a whole-document write.
      updatedUser = await addCoins(ad.userId, refundAmount);
      refundedAmount = refundAmount;
    }

    // Get user for email
    if (!updatedUser) {
      updatedUser = await User.findById(ad.userId);
    }

    // Reject the ad and mark coins as refunded (once)
    const updatedAd = await Product.findByIdAndUpdate(
      adId,
      {
        status: "rejected",
        rejectReason: reason || "",
        coinsRefunded: refundAmount > 0 ? true : false,
      },
      { new: true },
    );

    // Save coin refund transaction record
    if (refundAmount > 0) {
      await CoinTransaction.create({
        userId: ad.userId,
        transactionType: "refunded",
        coinsAmount: refundAmount,
        adId: adId,
        adType: ad.adType,
        reason: `Coins refunded for rejected advertisement "${ad.title}"`,
        status: "completed",
      });
    }

    // Send rejection email to user with refund information
    const user = await User.findById(ad.userId);
    if (user && user.email) {
      try {
        const remainingCoins = updatedUser
          ? updatedUser.coins
          : user
            ? user.coins
            : 0;
        await sendAdRejectionMail(
          user.email,
          ad.title,
          ad._id.toString(),
          reason || "",
          refundedAmount,
          remainingCoins,
        );
      } catch (emailError) {
        console.error("Failed to send rejection email:", emailError);
        // Continue anyway - don't fail the rejection if email fails
      }
    }

    return res.status(200).json({
      success: true,
      message: `Advertisement rejected successfully${refundedAmount > 0 ? ` and ${refundedAmount} coins refunded to user` : ""}`,
      ad: updatedAd,
      refundedCoins: refundedAmount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUserAdsForDashboard = async (req, res) => {
  try {
    const userId = req.id;

    const userAds = await Product.find({ userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "User advertisements fetched",
      ads: userAds,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
