/**
 * Backfill the comparison fields used by spam detection.
 *
 * New accounts/ads set these automatically. This script fills them in for rows
 * created before the change, so the online cross-account check can use its
 * indexes instead of falling back to a raw-title regex forever.
 *
 * Safe to run more than once. Dry run unless `--confirm` is passed.
 *
 *   node scripts/backfill-spam-index.js
 *   node scripts/backfill-spam-index.js --confirm
 */
import mongoose from "mongoose";
import "dotenv/config";

import { User } from "../models/userModel.js";
import { Product } from "../models/productModel.js";
import { canonicalEmail } from "../utils/identity.js";
import { normalizePhone } from "../utils/identity.js";
import { normalizeForCompare } from "../utils/adValidation.js";

const confirm = process.argv.includes("--confirm");

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
});

const batchSize = 500;
let usersUpdated = 0;
let productsUpdated = 0;

let lastUserId = null;
while (true) {
  const filter = lastUserId ? { _id: { $gt: lastUserId } } : {};
  const batch = await User.find(filter)
    .select("_id email emailCanonical")
    .sort({ _id: 1 })
    .limit(batchSize)
    .lean();

  if (!batch.length) break;
  lastUserId = batch[batch.length - 1]._id;

  const operations = [];
  for (const user of batch) {
    const emailCanonical = canonicalEmail(user.email);
    if (user.emailCanonical === emailCanonical) continue;
    operations.push({
      updateOne: {
        filter: { _id: user._id },
        update: { $set: { emailCanonical } },
      },
    });
  }

  if (operations.length) {
    usersUpdated += operations.length;
    if (confirm) await User.bulkWrite(operations, { ordered: false });
  }
}

let lastProductId = null;
while (true) {
  const filter = lastProductId ? { _id: { $gt: lastProductId } } : {};
  const batch = await Product.find(filter)
    .select(
      "_id title titleNormalized contact contactNormalized whatsapp whatsappNormalized",
    )
    .sort({ _id: 1 })
    .limit(batchSize)
    .lean();

  if (!batch.length) break;
  lastProductId = batch[batch.length - 1]._id;

  const operations = [];
  for (const product of batch) {
    const titleNormalized = normalizeForCompare(product.title);
    const contactNormalized = normalizePhone(product.contact);
    const whatsappNormalized = normalizePhone(product.whatsapp);

    if (
      product.titleNormalized === titleNormalized &&
      product.contactNormalized === contactNormalized &&
      product.whatsappNormalized === whatsappNormalized
    ) {
      continue;
    }

    operations.push({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: { titleNormalized, contactNormalized, whatsappNormalized },
        },
      },
    });
  }

  if (operations.length) {
    productsUpdated += operations.length;
    if (confirm) await Product.bulkWrite(operations, { ordered: false });
  }
}

console.log(`
Backfill ${confirm ? "complete" : "preview"}
  users updated     ${usersUpdated}
  products updated  ${productsUpdated}
`);

if (!confirm) {
  console.log("Nothing was written. Re-run with --confirm to apply.\n");
}

await mongoose.disconnect();
