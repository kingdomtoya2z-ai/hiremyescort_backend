import { Product } from "../models/productModel.js";

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 700;

/** A user may have at most one live free ad at a time. */
export const FREE_AD_LIMIT = 1;

/**
 * Photo allowance per ad type.
 * Free ads carry no photo at all; golden carries two; premium is unchanged at four.
 */
export const MAX_IMAGES_FREE = 0;
export const MAX_IMAGES_GOLDEN = 2;
export const MAX_IMAGES_PREMIUM = 4;

const MAX_IMAGES_BY_TYPE = {
  free: MAX_IMAGES_FREE,
  golden: MAX_IMAGES_GOLDEN,
  premium: MAX_IMAGES_PREMIUM,
};

export const getMaxImagesForAdType = (adType) =>
  MAX_IMAGES_BY_TYPE[normalizeAdType(adType)] ?? MAX_IMAGES_PREMIUM;

/**
 * Lifetime after approval, per ad type.
 * Free expires in 24 hours, golden in 4 days, premium in 1 week.
 */
export const AD_EXPIRY_DAYS = {
  free: 1,
  golden: 4,
  premium: 7,
};

/** Human-readable lifetime, used in the expiry email and in the UI copy. */
export const AD_EXPIRY_LABEL = {
  free: "24 hours",
  golden: "4 days",
  premium: "1 week",
};

/**
 * The single place an ad's expiry is calculated.
 *
 * This replaces two hand-kept copies (one in approveAd, one in the expiry
 * checker) that had to be edited together and had already drifted.
 *
 * Expiry is measured from the approval date, never from creation, so a pending
 * ad does not burn its lifetime while it waits in the admin queue.
 */
export const calculateExpiryDate = (adType, approvalDate) => {
  const base = new Date(approvalDate);
  const days = AD_EXPIRY_DAYS[normalizeAdType(adType)] ?? AD_EXPIRY_DAYS.premium;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
};

export const getExpiryLabel = (adType) =>
  AD_EXPIRY_LABEL[normalizeAdType(adType)] ?? AD_EXPIRY_LABEL.premium;

/**
 * Ad types that carry contact details: Golden and Premium.
 *
 * Free ads are listed without any way to reach the advertiser, so their fields
 * are removed on the way in rather than merely hidden on the way out.
 *
 * Contact is a per-page decision, not a per-type one: both types that hold a
 * number show the call and WhatsApp buttons on the ad's own profile, and
 * neither shows them in a listing. A listing is a comparison surface, so the
 * buttons live where a visitor has already picked one ad.
 */
export const ALLOWED_CONTACT_TYPES = ["golden", "premium"];

export const allowsContact = (adType) =>
  ALLOWED_CONTACT_TYPES.includes(normalizeAdType(adType));

export function normalizeAdType(adType) {
  const v = String(adType || "free").toLowerCase().trim();
  if (v === "golden") return "golden";
  if (v === "premium") return "premium";
  return "free";
}

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

/* ------------------------------------------------------------------ *
 * Duplicate detection
 * ------------------------------------------------------------------ */

/**
 * Reduce text to comparable form: lowercase, strip punctuation, collapse runs of
 * whitespace. "Best  Rate  -  Mumbai!!" and "best rate mumbai" both collapse to
 * "best rate mumbai", so a re-post cannot slip through on punctuation alone.
 */
export const normalizeForCompare = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const tokenSet = (text) => new Set(normalizeForCompare(text).split(" ").filter(Boolean));

/**
 * Jaccard overlap between two word sets, 0..1.
 * Chosen over a length ratio because it does not punish a description that was
 * padded with an extra sentence.
 */
export const similarity = (a, b) => {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;

  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
};

/** Above this overlap the copy is treated as the same ad. */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

/**
 * Find one of a user's existing ads that is effectively the same as the ad being
 * posted.
 *
 * Only live ads are considered: once an ad has expired or been rejected the user
 * is free to post the same copy again, which is how the short free-ad lifetime
 * stays usable.
 *
 * The title is compared on exact normalised equality (a title is short, so near
 * matches are usually genuinely different ads), while the description is
 * compared on word overlap, which is what catches a re-post with a small edit.
 */
export const findDuplicateAd = async (userId, { title, about }, excludeProductId) => {
  const query = {
    userId,
    isExpired: false,
    status: { $in: ["pending", "approved"] },
  };
  if (excludeProductId) {
    query._id = { $ne: excludeProductId };
  }

  const existing = await Product.find(query)
    .select("title about")
    .lean();

  const normTitle = normalizeForCompare(title);
  const candidates = [];

  for (const doc of existing) {
    const normExistingTitle = normalizeForCompare(doc.title);

    if (normTitle && normExistingTitle && normTitle === normExistingTitle) {
      return { reason: "title", existing: doc };
    }

    const score = similarity(about, doc.about);
    if (score >= DUPLICATE_SIMILARITY_THRESHOLD) {
      candidates.push({ reason: "description", score, existing: doc });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  return null;
};

export const DUPLICATE_MESSAGE =
  "You already have an ad with this title or a very similar description. Edit or delete your existing ad instead of posting a duplicate.";