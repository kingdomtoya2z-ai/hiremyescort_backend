/**
 * Overdraft regression test — the negative-balance bug.
 *
 * The rule under test: **a coin balance must never go below zero, no matter how
 * many ads are posted at the same time.**
 *
 * The bug it locks down: every controller read the balance, compared it in
 * JavaScript, and wrote the decrement as a separate operation. In `addProduct`
 * the gap between the two spans the entire Cloudinary upload — seconds. Two
 * requests arriving together both read the same balance, both passed the check,
 * and both deducted.
 *
 * It is not theoretical. `piryapatelriya1209@gmail.com` holds two golden ads
 * created 648 ms apart, each charged 100 coins from a balance of 100, and the
 * account sits at -100. A zero-balance account posting two premium ads at once
 * lands on exactly -400.
 *
 * This needs a real MongoDB, because the whole point is whether the database
 * serialises a conditional update. It creates throwaway users, asserts on them,
 * and deletes them — it never reads or writes a real account.
 *
 * Run with `npm run test:overdraft`.
 */
import mongoose from "mongoose";
import "dotenv/config";

import { User } from "../models/userModel.js";
import { spendCoins } from "../utils/coinLedger.js";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const EMAIL_DOMAIN = "@overdraft-test.invalid";
const created = [];

async function makeUser(coins) {
  const user = await User.create({
    firstName: "Overdraft",
    lastName: "Test",
    email: `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${EMAIL_DOMAIN}`,
    phoneNo: "9000000000",
    password: "not-a-real-password",
    coins,
  });
  created.push(user._id);
  return user;
}

async function cleanup() {
  await User.deleteMany({ _id: { $in: created } });
}

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

console.log("\nConcurrent spends cannot overdraw:");

/*
 * The real scenario: a user with 100 coins fires several premium posts at once.
 * Exactly one may succeed.
 */
{
  const user = await makeUser(100);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => spendCoins(user._id, 100)),
  );
  const succeeded = results.filter(Boolean).length;
  const after = await User.findById(user._id).lean();

  check(
    `5 concurrent spends of 100 from a balance of 100 -> exactly 1 succeeds (got ${succeeded})`,
    succeeded === 1,
    `more than one request passed the affordability check`,
  );
  check(
    `balance lands on 0, never negative (got ${after.coins})`,
    after.coins === 0,
    `the balance went to ${after.coins}, which is the bug this test exists for`,
  );
}

/*
 * A partial balance: 250 coins, four concurrent premium posts at 200. At most
 * one can be funded, and the balance must stay at 50.
 */
{
  const user = await makeUser(250);
  await Promise.all(Array.from({ length: 4 }, () => spendCoins(user._id, 200)));
  const after = await User.findById(user._id).lean();

  check(
    `250 coins, 4 concurrent spends of 200 -> balance 50, never negative (got ${after.coins})`,
    after.coins === 50,
    `expected 50, got ${after.coins}`,
  );
}

/*
 * The reported figure: a zero-balance account posting two premium ads at once
 * used to land on exactly -400.
 */
{
  const user = await makeUser(0);
  await Promise.all([
    spendCoins(user._id, 200),
    spendCoins(user._id, 200),
  ]);
  const after = await User.findById(user._id).lean();

  check(
    `the reported -400 case now stays at 0 (got ${after.coins})`,
    after.coins === 0,
    "a zero-balance account must not be able to buy two premium ads",
  );
}

/*
 * Spending must still work normally — the fix cannot be "always refuse".
 */
{
  const user = await makeUser(500);
  const a = await spendCoins(user._id, 100);
  const b = await spendCoins(user._id, 200);
  const after = await User.findById(user._id).lean();

  check("a funded spend succeeds and returns the new balance", a?.coins === 400, `got ${a?.coins}`);
  check("a second funded spend succeeds", b?.coins === 200, `got ${b?.coins}`);
  check("balance is 500 - 100 - 200 = 200", after.coins === 200, `got ${after.coins}`);
}

/*
 * A free ad costs nothing and must never be blocked by the coin guard.
 */
{
  const user = await makeUser(0);
  const zero = await spendCoins(user._id, 0);
  const after = await User.findById(user._id).lean();

  check("a zero-cost ad is never refused for coins", Boolean(zero));
  check("a zero-cost ad leaves the balance untouched", after.coins === 0, `got ${after.coins}`);
}

/*
 * A user with no `coins` field at all must fail closed, not be read as rich.
 */
{
  const user = await makeUser(0);
  await User.updateOne({ _id: user._id }, { $unset: { coins: "" } });
  const result = await spendCoins(user._id, 100);
  const after = await User.findById(user._id).lean();

  check("a missing balance field fails closed", result === null);
  check("a missing balance field is not created as negative", after?.coins === undefined || after.coins >= 0,
    `got ${after?.coins}`);
}

await cleanup();
await mongoose.disconnect();

console.log(
  failures === 0
    ? "\nAll overdraft checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);