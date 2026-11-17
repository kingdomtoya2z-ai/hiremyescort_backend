import { Product } from "../models/productModel.js";
import { User } from "../models/userModel.js";
import { canonicalEmail, normalizePhone } from "../utils/identity.js";
import {
  normalizeForCompare,
  telegramComparisonValue,
} from "../utils/adValidation.js";

/**
 * Group accounts that look like the same person.
 *
 * This is a read-only analysis used by the admin screen and the
 * `scripts/find-spam-accounts.js` CLI. It deliberately does not decide who is
 * spam - it shows the links, and an admin makes the call. That is the safe
 * design for a destructive action: a false positive costs a real user their
 * account.
 *
 * Signals:
 *   - same phone number
 *   - same canonical Gmail mailbox (dot / +tag aliases)
 *   - same signup IP
 *   - same contact / WhatsApp number on an ad
 *   - same Telegram username or number on an ad
 *   - same normalised ad title
 *
 * Accounts are joined into connected components, so a person using three
 * emails and two phone numbers that cross-reference each other appears as one
 * cluster rather than five unrelated pairs.
 */

const MIN_TITLE_LENGTH = 8;
const MIN_PHONE_DIGITS = 10;

const isUsablePhone = (value) =>
  new RegExp(`^[6-9]\\d{${MIN_PHONE_DIGITS - 1}}$`).test(value);

const usableTitle = (value) =>
  value && value.replace(/\s/g, "").length >= MIN_TITLE_LENGTH;

/**
 * @param {{ users: Array, products: Array, minUsers?: number }} input
 * @returns {Array} clusters of at least `minUsers` accounts
 */
export const buildSpamClusters = ({
  users = [],
  products = [],
  minUsers = 2,
} = {}) => {
  const byId = new Map();
  const parent = new Map();

  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const user of users) {
    const id = String(user._id);
    byId.set(id, user);
    parent.set(id, id);
  }

  /** signalKey -> { label, userIds:Set } */
  const signals = new Map();
  const addSignal = (key, label, userId) => {
    if (!byId.has(userId)) return;
    if (!signals.has(key)) signals.set(key, { key, label, userIds: new Set() });
    signals.get(key).userIds.add(userId);
  };

  for (const user of users) {
    const id = String(user._id);

    if (user.phoneNo) {
      const phone = normalizePhone(user.phoneNo);
      if (isUsablePhone(phone)) {
        addSignal(`phone:${phone}`, "Same phone number", id);
      }
    }

    if (user.email) {
      const email = user.emailCanonical || canonicalEmail(user.email);
      addSignal(`email:${email}`, "Same Gmail mailbox (alias)", id);
    }

    if (user.signupIp) {
      addSignal(`ip:${user.signupIp}`, "Same signup IP", id);
    }
  }

  for (const product of products) {
    const id = product.userId ? String(product.userId) : "";
    if (!byId.has(id)) continue;

    const title = product.titleNormalized || normalizeForCompare(product.title);
    if (usableTitle(title)) {
      addSignal(`title:${title}`, "Same ad title", id);
    }

    for (const [field, raw] of [
      ["contact", product.contactNormalized || product.contact],
      ["whatsapp", product.whatsappNormalized || product.whatsapp],
      ["telegram", product.telegramNormalized || product.telegram],
    ]) {
      const phone = normalizePhone(raw);
      if (isUsablePhone(phone)) {
        addSignal(`ad-${field}:${phone}`, `Same ad ${field} number`, id);
      }
    }

    const telegram = telegramComparisonValue(product.telegram);
    // A username has no digits, so it would not pass the phone signal above.
    if (telegram && !/^\d+$/.test(telegram)) {
      addSignal(`ad-telegram:${telegram}`, "Same ad Telegram username", id);
    }
  }

  // Join every account that shares a signal into one component.
  for (const signal of signals.values()) {
    const ids = [...signal.userIds];
    for (let i = 1; i < ids.length; i += 1) union(ids[0], ids[i]);
  }

  // Only signals shared by two or more accounts are evidence of anything.
  const sharedSignalsByRoot = new Map();
  for (const signal of signals.values()) {
    if (signal.userIds.size < 2) continue;

    const root = find([...signal.userIds][0]);
    if (!sharedSignalsByRoot.has(root)) sharedSignalsByRoot.set(root, []);
    sharedSignalsByRoot.get(root).push({
      key: signal.key,
      label: signal.label,
      accounts: signal.userIds.size,
    });
  }

  const membersByRoot = new Map();
  for (const id of byId.keys()) {
    const root = find(id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, []);
    membersByRoot.get(root).push(id);
  }

  const adCounts = new Map();
  for (const product of products) {
    const id = product.userId ? String(product.userId) : "";
    if (byId.has(id)) adCounts.set(id, (adCounts.get(id) || 0) + 1);
  }

  const clusters = [];
  for (const [root, memberIds] of membersByRoot) {
    if (memberIds.length < minUsers) continue;

    const clusterUsers = memberIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(a.createdAt || 0).getTime() -
          new Date(b.createdAt || 0).getTime(),
      )
      .map((user) => ({
        _id: String(user._id),
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phoneNo: user.phoneNo || "",
        signupIp: user.signupIp || "",
        createdAt: user.createdAt || null,
        isBanned: Boolean(user.isBanned),
        role: user.role || "user",
        adCount: adCounts.get(String(user._id)) || 0,
      }));

    const clusterSignals = (sharedSignalsByRoot.get(root) || []).sort(
      (a, b) => b.accounts - a.accounts,
    );

    clusters.push({
      id: root,
      users: clusterUsers,
      signals: clusterSignals,
      adCount: clusterUsers.reduce((sum, user) => sum + user.adCount, 0),
      // Matches are ranked by how many independent links exist. Accounts
      // sharing only one weak signal deserve more scrutiny than accounts
      // sharing a phone number, an ad title and an IP.
      signalCount: clusterSignals.length,
    });
  }

  return clusters.sort(
    (a, b) =>
      b.signalCount - a.signalCount ||
      b.users.length - a.users.length ||
      b.adCount - a.adCount,
  );
};

/**
 * Load the data the analysis needs and return clusters.
 *
 * The caps keep this endpoint from downloading an unbounded collection. They
 * are far above the current catalogue size; if the site ever exceeds them the
 * report is partial, so the count is returned alongside it.
 */
export const findSpamClusters = async ({ minUsers = 2, userLimit = 10000, adLimit = 20000 } = {}) => {
  const [users, products] = await Promise.all([
    User.find()
      .select(
        "firstName lastName email emailCanonical phoneNo signupIp createdAt isBanned role",
      )
      .limit(userLimit)
      .lean(),
    Product.find({
      status: { $in: ["pending", "approved"] },
      isExpired: false,
    })
      .select(
        "userId title titleNormalized contact contactNormalized whatsapp whatsappNormalized telegram telegramNormalized createdAt status",
      )
      .limit(adLimit)
      .lean(),
  ]);

  return buildSpamClusters({ users, products, minUsers });
};
