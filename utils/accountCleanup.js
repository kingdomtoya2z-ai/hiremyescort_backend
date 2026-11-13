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

/** Destroy every Cloudinary image attached to these products. */
export const destroyProductImages = async (products = []) => {
  const publicIds = products
    .flatMap((product) => product?.productImg || [])
    .map((image) => image?.public_id)
    .filter(Boolean);

  let deleted = 0;
  const chunkSize = 20;

  for (let i = 0; i < publicIds.length; i += chunkSize) {
    const chunk = publicIds.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((publicId) => cloudinary.uploader.destroy(publicId)),
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
