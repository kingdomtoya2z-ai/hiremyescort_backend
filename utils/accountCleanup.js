import { Product } from "../models/productModel.js";
import { User } from "../models/userModel.js";
import { Session } from "../models/sessionModel.js";
import { CoinTransaction } from "../models/coinTransactionModel.js";
import cloudinary from "./cloudinary.js";
import { blockIdentities } from "./blocklist.js";

/**
 * Shared account-removal helpers.
 *
 * Removing a spam account must also remove the things that outlive its user
 * row: ads, Cloudinary images, sessions and coin transactions. The previous
 * `deleteUser` handled most of this, but the new bulk/ban paths need exactly
 * the same behaviour, and a second hand-written copy is how one path ends up
 * forgetting the images.
 */

/**
 * Destroy every Cloudinary image attached to these products.
 *
 * Image deletion must never stop the account cleanup. If the credentials are
 * missing (for example when the CLI scripts run from a machine that only has
 * MONGO_URI) or Cloudinary is down, the account and its ads still need to be
 * removed. The API also throws synchronously for missing config, which would
 * escape Promise.allSettled, so each call is wrapped.
 */
export const destroyProductImages = async (products = []) => {
  const publicIds = products
    .flatMap((product) => product?.productImg || [])
    .map((image) => image?.public_id)
    .filter(Boolean);

  const configured =
    process.env.CLOUD_NAME && process.env.API_KEY && process.env.API_SECRET;

  if (!publicIds.length) {
    return { imagesDeleted: 0, imagesFound: 0, imagesSkipped: false };
  }

  if (!configured) {
    console.warn(
      `Skipping ${publicIds.length} Cloudinary image(s): CLOUD_NAME/API_KEY/API_SECRET are not set.`,
    );
    return {
      imagesDeleted: 0,
      imagesFound: publicIds.length,
      imagesSkipped: true,
    };
  }

  let deleted = 0;
  const chunkSize = 20;

  for (let i = 0; i < publicIds.length; i += chunkSize) {
    const chunk = publicIds.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((publicId) =>
        Promise.resolve().then(() => cloudinary.uploader.destroy(publicId)),
      ),
    );
    deleted += results.filter((result) => result.status === "fulfilled").length;
  }

  return { imagesDeleted: deleted, imagesFound: publicIds.length };
};

/**
 * Delete a user and everything owned by them.
 *
 * Coin transactions are deleted too. They contain the user's ObjectId and ad
 * references, so leaving them behind creates orphaned records that no longer
 * correspond to an account.
 */
export const deleteUserCascade = async (
  userId,
  { deleteAds = true, deleteCoinHistory = true } = {},
) => {
  const products = deleteAds
    ? await Product.find({ userId }).select("productImg").lean()
    : [];

  const { imagesDeleted, imagesFound } = await destroyProductImages(products);

  if (deleteAds) {
    await Product.deleteMany({ userId });
  }

  if (deleteCoinHistory) {
    await CoinTransaction.deleteMany({ userId });
  }

  await Session.deleteMany({ userId });
  await User.findByIdAndDelete(userId);

  return {
    adsDeleted: products.length,
    imagesDeleted,
    imagesFound,
  };
};

/**
 * Add the account's email, phone and signup IP to the blocklist.
 *
 * These are what stop the same person registering again after the account
 * itself is gone. The canonical forms are stored, so a new Gmail alias or a
 * differently formatted phone number still matches.
 */
export const blockUserIdentities = async (
  user,
  { reason = "", createdBy = "admin" } = {},
) => {
  if (!user) return [];

  return blockIdentities(
    [
      { type: "email", value: user.email },
      { type: "phone", value: user.phoneNo },
      { type: "ip", value: user.signupIp },
    ],
    { reason, sourceUserId: user._id, createdBy },
  );
};
