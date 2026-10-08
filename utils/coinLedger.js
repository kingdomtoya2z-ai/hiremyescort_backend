import { User } from "../models/userModel.js";

/**
 * Coin balance writes.
 *
 * Every spend goes through `spendCoins`, which makes the affordability check
 * and the decrement a **single** conditional database operation. That is the
 * whole point of this file.
 *
 * The bug it replaces, which is why it exists: the controllers used to read the
 * balance, compare it in JavaScript, and then write the decrement separately.
 * Those are two operations with a gap between them, and in `addProduct` the gap
 * spans the whole Cloudinary upload — seconds. Two requests arriving together
 * both read the same balance, both pass the check, and both deduct, so the
 * account goes negative and one ad is effectively free.
 *
 * This really happened. `piryapatelriya1209@gmail.com` holds two golden ads
 * created 648 ms apart, each charged 100 coins from a balance of 100, and the
 * account sits at -100. A zero-balance account posting two premium ads at once
 * lands on exactly -400.
 *
 * `spendCoins` cannot overdraw because MongoDB applies the `coins: { $gte }`
 * predicate and the `$inc` as one atomic document update: either the balance
 * was sufficient and it is decremented, or the predicate fails and nothing is
 * written. A missing or null `coins` field fails the predicate, so an account
 * with no balance cannot be treated as rich.
 */

/**
 * Spend `amount` coins, or change nothing.
 *
 * @returns the updated user, or `null` when the balance was insufficient or the
 *          user does not exist. Callers must treat `null` as "not charged" and
 *          must not create the ad.
 */
export const spendCoins = async (userId, amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    // Nothing to spend. Return the user so the caller can read the balance.
    return User.findById(userId);
  }

  return User.findOneAndUpdate(
    { _id: userId, coins: { $gte: value } },
    { $inc: { coins: -value } },
    { new: true },
  );
};

/**
 * Add coins back. Used by the rejection refund and the admin top-up.
 *
 * Atomic for the same reason, and it deliberately does not clamp: a refund must
 * never be silently reduced.
 */
export const addCoins = async (userId, amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) {
    return User.findById(userId);
  }
  return User.findOneAndUpdate(
    { _id: userId },
    { $inc: { coins: value } },
    { new: true },
  );
};

/** Read a balance without any write path. */
export const getBalance = async (userId) => {
  const user = await User.findById(userId).select("coins").lean();
  return user?.coins ?? 0;
};

/** The message every caller shows when `spendCoins` returns null. */
export const insufficientCoinsMessage = (needed, current, adType) =>
  `Insufficient coins. You need ${needed} coins for a ${adType} ad. You have ${current} coins.`;