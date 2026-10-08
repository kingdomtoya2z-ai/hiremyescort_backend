/**
 * READ-ONLY audit of one user's coin ledger.
 *
 * Answers "how did this balance go negative" from the transaction records
 * rather than by guessing at the code. Opens no write path: it only ever calls
 * find/aggregate.
 *
 * Usage: node scripts/audit-coins.js <email>
 */
import mongoose from "mongoose";
import "dotenv/config";

import { User } from "../models/userModel.js";
import { CoinTransaction } from "../models/coinTransactionModel.js";
import { Product } from "../models/productModel.js";

const email = process.argv[2];
if (!email) {
  console.error("usage: node scripts/audit-coins.js <email>");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const user = await User.findOne({ email }).lean();
if (!user) {
  console.log(`no user with email ${email}`);
  await mongoose.disconnect();
  process.exit(1);
}

console.log(`\n=== ${user.email} ===`);
console.log(`balance: ${user.coins}`);

const txns = await CoinTransaction.find({ userId: user._id })
  .sort({ createdAt: 1 })
  .lean();

console.log(`\ncoin transactions (${txns.length}), oldest first:`);
let running = 0;
for (const t of txns) {
  const amt = t.coinsAmount ?? 0;
  running += t.transactionType === "deducted" ? -amt : amt;
  console.log(
    `  ${new Date(t.createdAt).toISOString()}  ${String(t.transactionType).padEnd(10)}` +
      ` ${String(amt).padStart(5)}  running=${String(running).padStart(6)}` +
      `  ad=${t.adId ?? "-"}  ${t.adType ?? "-"}  status=${t.status ?? "-"}`,
  );
}
console.log(`  sum of transactions: ${running}`);

const ads = await Product.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
console.log(`\nads (${ads.length}):`);
for (const a of ads) {
  console.log(
    `  ${new Date(a.createdAt).toISOString()}  ${String(a.adType).padEnd(8)} ${String(a.status).padEnd(9)}` +
      ` coinsRefunded=${a.coinsRefunded ?? false}  approval=${a.approvalDate ? new Date(a.approvalDate).toISOString().slice(0, 10) : "-"}` +
      ` expiry=${a.expiryDate ? new Date(a.expiryDate).toISOString().slice(0, 10) : "-"}  id=${a._id}`,
  );
}

const paid = ads.filter((a) => ["golden", "premium"].includes(String(a.adType).toLowerCase()));
console.log(`\npaid ads: ${paid.length}, total coins they should have cost at most: ${paid.length * 200}`);
console.log(`actual balance: ${user.coins}`);

await mongoose.disconnect();