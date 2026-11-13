/**
 * Remove spam accounts and stop them coming back.
 *
 * Select the accounts one of three ways:
 *   --emails spam1@gmail.com,spam2@gmail.com
 *   --ids 64f...,64f...
 *   --file /tmp/spam-report.json       (the report from find-spam-accounts.js)
 *
 * It is a DRY RUN unless you pass `--confirm`. In dry-run mode it prints the
 * accounts and how many ads/images would be removed, and changes nothing.
 *
 * On confirmation, for each account it:
 *   1. adds the canonical email, phone and signup IP to the blocklist,
 *   2. deletes the ads and their Cloudinary images,
 *   3. deletes sessions and coin transactions,
 *   4. deletes the user.
 *
 * Admin accounts and ADMIN_EMAIL are always skipped.
 *
 * Usage:
 *   node scripts/delete-spam-accounts.js --emails spam@gmail.com
 *   node scripts/delete-spam-accounts.js --file /tmp/spam-report.json --confirm
 *   node scripts/delete-spam-accounts.js --ids ... --soft-ban --confirm
 */
import mongoose from "mongoose";
import "dotenv/config";
import { readFile } from "node:fs/promises";

import { User } from "../models/userModel.js";
import { Product } from "../models/productModel.js";
import { canonicalEmail } from "../utils/identity.js";
import {
  blockUserIdentities,
  deleteUserCascade,
  destroyProductImages,
} from "../utils/accountCleanup.js";
import { Session } from "../models/sessionModel.js";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const csv = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const confirm = hasFlag("--confirm");
const softBan = hasFlag("--soft-ban");
const skipBlock = hasFlag("--no-block");
const keepAds = hasFlag("--keep-ads");
const reason = option("--reason", "Spam or abusive account");

const ids = new Set(csv(option("--ids", "")));
const emails = new Set(csv(option("--emails", "")));

const collectFromFile = async (file) => {
  const raw = await readFile(file, "utf8");
  const json = JSON.parse(raw);

  const add = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    if (/^[a-f0-9]{24}$/i.test(text)) ids.add(text);
    else if (text.includes("@")) emails.add(text);
  };

  const addUser = (user) => {
    add(user?._id);
    add(user?.email);
  };

  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === "string") add(item);
      else addUser(item);
    }
    return;
  }

  if (Array.isArray(json.clusters)) {
    for (const cluster of json.clusters) {
      for (const user of cluster.users || []) addUser(user);
    }
    return;
  }

  for (const key of ["userIds", "ids", "users", "emails"]) {
    if (!Array.isArray(json[key])) continue;
    for (const item of json[key]) {
      if (typeof item === "string" && key === "emails") add(item);
      else if (typeof item === "string") add(item);
      else addUser(item);
    }
  }
};

const file = option("--file", "");
if (file) {
  await collectFromFile(file);
}

if (!ids.size && !emails.size) {
  console.error(`
Nothing selected. Pass one of:

  --emails spam1@gmail.com,spam2@gmail.com
  --ids 64f...,64f...
  --file /tmp/spam-report.json

Add --confirm to actually delete. Without it this is a dry run.
`);
  process.exit(1);
}

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
});

const or = [];
const validIds = [...ids].filter((id) => mongoose.isValidObjectId(id));
const invalidIds = [...ids].filter((id) => !mongoose.isValidObjectId(id));

if (invalidIds.length) {
  console.warn(`Ignoring ${invalidIds.length} invalid id(s): ${invalidIds.join(", ")}`);
}

if (validIds.length) or.push({ _id: { $in: validIds } });
for (const email of emails) {
  or.push({ email }, { emailCanonical: canonicalEmail(email) });
}

if (!validIds.length && !emails.size) {
  console.error("No valid ids or emails were selected.");
  await mongoose.disconnect();
  process.exit(1);
}

const users = await User.find({ $or: or })
  .select("_id firstName lastName email phoneNo signupIp role isBanned createdAt")
  .limit(500)
  .lean();

if (!users.length) {
  console.log("No matching accounts found.");
  await mongoose.disconnect();
  process.exit(0);
}

console.log(
  `\n${confirm ? "DELETING" : "DRY RUN"} · ${users.length} account(s) selected\n`,
);

const summary = {
  selected: users.length,
  deleted: 0,
  banned: 0,
  skipped: 0,
  adsDeleted: 0,
  imagesDeleted: 0,
  blocked: 0,
};

for (const user of users) {
  const name = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unnamed";
  const ads = await Product.find({ userId: user._id })
    .select("productImg")
    .lean();

  const protectedAccount =
    user.role === "admin" || user.email === process.env.ADMIN_EMAIL;

  console.log(
    `${protectedAccount ? "SKIP " : confirm ? "DELETE" : "WOULD DELETE"}  ${name} <${user.email}>`,
  );
  console.log(
    `        id=${user._id}  phone=${user.phoneNo || "-"}  ip=${user.signupIp || "-"}  ads=${ads.length}`,
  );

  if (protectedAccount) {
    console.log("        admin account protected\n");
    summary.skipped += 1;
    continue;
  }

  if (!confirm) {
    console.log(
      `        would block email/phone/ip${skipBlock ? " (disabled)" : ""} and remove ${ads.length} ad(s)\n`,
    );
    continue;
  }

  if (!skipBlock) {
    const blocked = await blockUserIdentities(user, {
      reason,
      createdBy: "cleanup-script",
    });
    summary.blocked += blocked.length;
  }

  if (softBan) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          isBanned: true,
          bannedAt: new Date(),
          banReason: reason,
          isLoggedIn: false,
          token: null,
          tokenExpiry: null,
        },
      },
    );
    await Session.deleteMany({ userId: user._id });

    if (!keepAds) {
      const imageResult = await destroyProductImages(ads);
      summary.imagesDeleted += imageResult.imagesDeleted;
      await Product.deleteMany({ userId: user._id });
      summary.adsDeleted += ads.length;
    }

    summary.banned += 1;
    console.log("        banned (account kept)\n");
    continue;
  }

  const removed = await deleteUserCascade(user._id, {
    deleteAds: !keepAds,
  });
  summary.deleted += 1;
  summary.adsDeleted += removed.adsDeleted;
  summary.imagesDeleted += removed.imagesDeleted;
  console.log("        deleted\n");
}

console.log(`
Summary
  selected        ${summary.selected}
  deleted         ${summary.deleted}
  banned          ${summary.banned}
  skipped         ${summary.skipped}
  ads removed     ${summary.adsDeleted}
  images removed  ${summary.imagesDeleted}
  identifiers     ${summary.blocked} newly blocked
`);

if (!confirm) {
  console.log("Nothing was changed. Re-run with --confirm to apply.\n");
}

await mongoose.disconnect();
