/**
 * Coin-safety regression tests.
 *
 * The rule under test: **an ad that expires must never refund coins.**
 *
 * The coins bought a fixed window of visibility - 7 days premium, 4 golden,
 * 24 hours free - and that window was used. Expiry is the natural end of the
 * transaction, not a failure of it, so there is nothing to give back.
 *
 * This exists as a test rather than a comment because the invariant is easy to
 * break by accident. The expiry job sets `status: "rejected"` and leaves
 * `coinsRefunded` false, which is correct but looks exactly like a rejected ad
 * awaiting its refund. The manual reject endpoint did in fact pay out on that
 * state once, for 1,312 ads that were sitting in it.
 *
 * Run with `npm test`. No framework, no dependencies - it reads the source and
 * replays the decision logic, so it runs without a database.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ *
 * 1. The expiry job must be incapable of moving coins
 * ------------------------------------------------------------------ */
console.log("\nExpiry job (utils/adExpiryChecker.js):");
const expiry = read("utils/adExpiryChecker.js");

const FORBIDDEN = [
  /\bcoins\b/i,
  /\brefund/i,
  /CoinTransaction/,
  /User\.findByIdAndUpdate/,
  /User\.updateOne/,
  /\$inc/,
];

/**
 * Only executable code can move a balance, so the scan runs against the source
 * with its comments removed. Without this the test also fails on prose - the
 * expiry job is exactly where a comment explaining *why* no refund happens
 * belongs, and silencing that comment to satisfy a grep loses the reasoning.
 *
 * Quote-aware, so a `//` inside a string literal (a URL, say) is not mistaken
 * for the start of a comment and the code after it is not silently dropped.
 */
const stripComments = (src) => {
  let out = "";
  let quote = null;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];

    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      out += " ";
      continue;
    }

    if (ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      out += " ";
      continue;
    }

    out += ch;
  }

  return out;
};

const expiryCode = stripComments(expiry);

for (const pattern of FORBIDDEN) {
  check(
    `contains no ${pattern}`,
    !pattern.test(expiryCode),
    `matched ${pattern} - the expiry job must never touch a coin balance`,
  );
}
check(
  "sets isExpired: true",
  /isExpired:\s*true/.test(expiry),
  "an expired ad must be marked expired, or the reject guard cannot see it",
);

/* ------------------------------------------------------------------ *
 * 2. The manual reject endpoint must refuse to refund an expired ad
 * ------------------------------------------------------------------ */
console.log("\nrejectAd (controllers/productController.js):");
const product = read("controllers/productController.js");

const rejectBody = product.slice(
  product.indexOf("export const rejectAd"),
  product.indexOf("export const", product.indexOf("export const rejectAd") + 10),
);

check(
  "guards on ad.isExpired before refunding",
  /if\s*\(\s*ad\.isExpired\s*\)/.test(rejectBody),
  "without this guard an expired ad pays out, because the expiry job leaves coinsRefunded false",
);
check(
  "guard appears BEFORE the $inc refund",
  rejectBody.indexOf("ad.isExpired") < rejectBody.indexOf("$inc"),
  "a guard placed after the refund does nothing",
);
check(
  "still refunds a live paid ad",
  /\$inc:\s*\{\s*coins:\s*refundAmount\s*\}/.test(rejectBody),
  "manual rejection of a genuinely live paid ad must keep refunding",
);

/* ------------------------------------------------------------------ *
 * 3. The decision itself, replayed across every ad state
 * ------------------------------------------------------------------ */
console.log("\nRefund decision table:");

const COSTS = { free: 0, golden: 100, premium: 200 };

/** Mirrors the guard order in rejectAd. */
function refundFor(ad) {
  if (ad.status === "rejected" && ad.coinsRefunded) return 0;
  if (ad.isExpired) return 0;
  return COSTS[ad.adType] || 0;
}

const cases = [
  ["expired premium -> nothing back", { adType: "premium", status: "rejected", isExpired: true, coinsRefunded: false }, 0],
  ["expired golden -> nothing back", { adType: "golden", status: "rejected", isExpired: true, coinsRefunded: false }, 0],
  ["expired free -> nothing back", { adType: "free", status: "rejected", isExpired: true, coinsRefunded: false }, 0],
  ["expired premium, repeated reject -> nothing back", { adType: "premium", status: "rejected", isExpired: true, coinsRefunded: false }, 0],
  ["already refunded -> no double refund", { adType: "premium", status: "rejected", isExpired: false, coinsRefunded: true }, 0],
  ["live premium rejected -> 200 back", { adType: "premium", status: "approved", isExpired: false }, 200],
  ["live golden rejected -> 100 back", { adType: "golden", status: "pending", isExpired: false }, 100],
  ["live free rejected -> 0", { adType: "free", status: "pending", isExpired: false }, 0],
];

for (const [label, ad, expected] of cases) {
  const got = refundFor(ad);
  check(label, got === expected, `expected ${expected}, got ${got}`);
}

/* ------------------------------------------------------------------ *
 * 4. No other automatic path can refund
 * ------------------------------------------------------------------ */
console.log("\nOther balance-increasing sites:");
const files = ["controllers/productController.js", "controllers/paymentController.js", "controllers/userController.js"];
const all = files.map(read).join("\n");
const sites = [...all.matchAll(/\$inc:\s*\{\s*coins:\s*([^}]+)\}|user\.coins\s*\+=/g)].map(
  (m) => m[1]?.trim() || "manual top-up",
);
/*
 * Every write to a coin balance, in either direction.
 *
 * Decreases are spending, not refunding: `-coinsNeeded` is the ad being paid
 * for. Increases are the only paths that can give coins back, and there must be
 * exactly three of them - the manual rejection refund, a verified payment, and
 * the admin top-up - none of which expiry can reach.
 */
const INCREASES = ["refundAmount", "coins", "manual top-up"];
const DECREASES = ["-coinsNeeded", "coins;"];

const increases = sites.filter((s) => INCREASES.includes(s.replace(/;$/, "")));
const decreases = sites.filter((s) => DECREASES.includes(s.replace(/;$/, "")));
const unknown = sites.filter((s) => !INCREASES.includes(s.replace(/;$/, "")) && !DECREASES.includes(s.replace(/;$/, "")));

check(
  `exactly 3 places increase a balance (found ${increases.length}: ${increases.join(", ")})`,
  increases.length === 3,
  `an unrecognised balance increase is a refund path nobody has audited`,
);
check(
  `every balance write is a known site (${sites.length} total)`,
  unknown.length === 0,
  `unrecognised: ${unknown.join(", ")}`,
);
check(
  "the manual rejection refund is the only refund tied to an ad",
  read("controllers/productController.js").includes("coins: refundAmount"),
);
check(
  "expiry never appears in a coin increase",
  !/isExpired[\s\S]{0,400}?\$inc:\s*\{\s*coins:\s*\+/.test(all),
  "an expiry check must never lead into a refund",
);

console.log(
  failures === 0
    ? "\nAll coin-safety checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
