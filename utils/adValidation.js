import { Product } from "../models/productModel.js";

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 700;
export const FREE_AD_LIMIT = 2;
export const MAX_IMAGES_DEFAULT = 4;
export const MAX_IMAGES_FREE = 1;

export const getMaxImagesForAdType = (adType) =>
  adType === "free" ? MAX_IMAGES_FREE : MAX_IMAGES_DEFAULT;

// Title and description must not exceed their limits and must not contain
// any digits (numbers are not allowed in title/description).
export const validateAdText = ({ title, about }) => {
  if (title !== undefined && title !== null) {
    const t = String(title);
    if (t.trim().length === 0) {
      return "Title is required";
    }
    if (t.length > TITLE_MAX_LENGTH) {
      return `Title cannot exceed ${TITLE_MAX_LENGTH} characters`;
    }
    if (/\d/.test(t)) {
      return "Numbers are not allowed in the title";
    }
  }
  if (about !== undefined && about !== null) {
    const d = String(about);
    if (d.length > DESCRIPTION_MAX_LENGTH) {
      return `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`;
    }
    if (/\d/.test(d)) {
      return "Numbers are not allowed in the description";
    }
  }
  return null;
};

// A user can post at most FREE_AD_LIMIT free ads at a time (pending/approved,
// not yet expired). Rejected/expired free ads do not count against the quota.
export const countActiveFreeAds = async (userId, excludeProductId) => {
  const query = {
    userId,
    adType: "free",
    isExpired: false,
    status: { $in: ["pending", "approved"] },
  };
  if (excludeProductId) {
    query._id = { $ne: excludeProductId };
  }
  return Product.countDocuments(query);
};