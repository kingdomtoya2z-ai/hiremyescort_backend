import { BlockedIdentity } from "../models/blockedIdentityModel.js";
import { canonicalEmail, normalizePhone } from "./identity.js";

/**
 * Normalise one block entry to its comparable form.
 * Returns null for an entry with no usable value.
 */
const normalizeEntry = ({ type, value }) => {
  if (type === "email") {
    const email = canonicalEmail(value);
    return email ? { type, value: email } : null;
  }
  if (type === "phone") {
    const phone = normalizePhone(value);
    return phone ? { type, value: phone } : null;
  }
  if (type === "ip") {
    const ip = String(value || "").replace(/^::ffff:/, "").trim();
    return ip ? { type, value: ip } : null;
  }
  return null;
};

/**
 * Return the first matching block entry, or null.
 *
 * Used by registration and login. Every supplied identifier is checked in one
 * query so this stays a single round trip on the sign-up path.
 */
export const findBlockedIdentity = async ({ email, phone, ip } = {}) => {
  const checks = [];
  if (email) checks.push({ type: "email", value: canonicalEmail(email) });
  if (phone) checks.push({ type: "phone", value: normalizePhone(phone) });
  if (ip) checks.push({ type: "ip", value: String(ip).replace(/^::ffff:/, "").trim() });

  const query = checks.filter((c) => c.value);
  if (!query.length) return null;

  return BlockedIdentity.findOne({ $or: query }).lean();
};

/**
 * Add one or more identifiers to the blocklist.
 *
 * Existing entries are skipped rather than treated as an error: blocking the
 * same spammer twice must be harmless. A concurrent insert can still race the
 * duplicate check, so a duplicate-key error is swallowed too.
 */
export const blockIdentities = async (
  entries,
  { reason = "", sourceUserId = null, createdBy = "admin" } = {},
) => {
  const docs = [];
  const seen = new Set();

  for (const entry of entries || []) {
    const normalized = normalizeEntry(entry || {});
    if (!normalized) continue;
    const key = `${normalized.type}:${normalized.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push({
      ...normalized,
      reason,
      sourceUserId,
      createdBy,
    });
  }

  if (!docs.length) return [];

  const existing = await BlockedIdentity.find({
    $or: docs.map(({ type, value }) => ({ type, value })),
  })
    .select("type value")
    .lean();

  const existingKeys = new Set(
    existing.map((entry) => `${entry.type}:${entry.value}`),
  );
  const toInsert = docs.filter(
    (entry) => !existingKeys.has(`${entry.type}:${entry.value}`),
  );

  if (!toInsert.length) return [];

  try {
    return await BlockedIdentity.insertMany(toInsert, { ordered: false });
  } catch (error) {
    // A duplicate means another request blocked the same identity first. That
    // is the desired end state, not a failure.
    if (error?.code === 11000 || error?.writeErrors) return [];
    throw error;
  }
};

export const listBlockedIdentities = async ({ type, limit = 200, search } = {}) => {
  const filter = type ? { type } : {};
  if (search && String(search).trim()) {
    const term = String(search).trim();
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");
    filter.$or = [{ value: regex }, { reason: regex }];
  }
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 5000);
  return BlockedIdentity.find(filter).sort({ createdAt: -1 }).limit(cap).lean();
};

export const unblockIdentity = async (id) =>
  BlockedIdentity.findByIdAndDelete(id);
