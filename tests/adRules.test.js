/**
 * Ad-rule regression tests.
 *
 * The rules under test, all of which are enforced in the controller and mirrored
 * on the client:
 *
 *   - photo allowance   free 0 · golden 2 · premium 4
 *   - contact details   golden + premium; stripped on the way in for free
 *   - lifetime          free 24 hours · golden 4 days · premium 1 week,
 *                       counted from approval
 *   - free-ad quota     one live free ad per account
 *   - duplicates        one account cannot run the same title or description twice
 *
 * Run with `npm test`. No framework and no database: the pure helpers are
 * imported directly and the controller is read as text to confirm the rules are
 * actually wired in, because a correct helper nobody calls is still a bug.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FREE_AD_LIMIT,
  DUPLICATE_SIMILARITY_THRESHOLD,
  allowsContact,
  calculateExpiryDate,
  getExpiryLabel,
  getMaxImagesForAdType,
  normalizeAdType,
  normalizeForCompare,
  similarity,
} from "../utils/adValidation.js";

/* The client mirror is plain ESM with no dependencies, so it imports directly. */
const clientRules = await import(
  new URL("../../frontend-next/src/lib/adRules.js", import.meta.url).href
);
const { showsListingContact, forListing } = clientRules;

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

const eq = (label, got, want) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ------------------------------------------------------------------ *
 * 1. Photo allowance
 * ------------------------------------------------------------------ */
console.log("\nPhoto allowance (utils/adValidation.js):");
eq("free = 0", getMaxImagesForAdType("free"), 0);
eq("golden = 2", getMaxImagesForAdType("golden"), 2);
eq("premium = 4", getMaxImagesForAdType("premium"), 4);
eq("case and padding tolerated", getMaxImagesForAdType(" PREMIUM "), 4);
eq("unknown type fails closed to free", getMaxImagesForAdType("bogus"), 0);
eq("missing type fails closed to free", getMaxImagesForAdType(undefined), 0);

/* ------------------------------------------------------------------ *
 * 2. Contact details are premium-only
 * ------------------------------------------------------------------ */
console.log("\nContact rules:");
eq("free carries no contact", allowsContact("free"), false);
eq("golden carries contact", allowsContact("golden"), true);
eq("premium carries contact", allowsContact("premium"), true);

/*
 * Where the buttons appear is separate from whether the ad holds a number, and
 * the two rules are deliberately different. Golden stores a contact and shows
 * call/WhatsApp on its own profile, but a listing row advertises only Premium.
 */
eq("free shows no listing buttons", showsListingContact("free"), false);
eq("golden shows no listing buttons", showsListingContact("golden"), false);
eq("premium shows listing buttons", showsListingContact("premium"), true);

/*
 * The listing must not ship a number it is not going to render. `RefinedAdGrid`
 * is a client component, so Next serialises every prop into the RSC payload in
 * the HTML: a Golden number with no button on the row would still be published
 * in the page source. `forListing` keeps contact for Premium only.
 */
const stripped = forListing({ _id: "1", adType: "golden", contact: "999", whatsapp: "999", title: "t" });
check("listing payload drops a golden number", stripped.contact === undefined && stripped.whatsapp === undefined,
  "a golden phone number would be readable in the listing HTML");
check("listing payload drops a free number",
  forListing({ adType: "free", contact: "999", whatsapp: "999" }).contact === undefined);
const keptPremium = forListing({ _id: "2", adType: "premium", contact: "999", whatsapp: "888" });
eq("listing payload keeps a premium number", [keptPremium.contact, keptPremium.whatsapp], ["999", "888"]);
eq("listing payload preserves other fields", forListing({ _id: "3", adType: "golden", title: "keep me" }).title, "keep me");

const card = read("../frontend-next/src/components/ads/AdCard.jsx");
check("listing row gates its buttons on the listing rule",
  /showsListingContact\(product\.adType\)/.test(card),
  "AdCard must gate on showsListingContact, not allowsContact");
const listing = read("../frontend-next/src/components/ads/AdListing.jsx");
check("listing strips contact before it reaches the client component",
  /forListingAll\(products\)/.test(listing),
  "whole products would put every non-premium number in the RSC payload");

/* ------------------------------------------------------------------ *
 * 3. Lifetime, measured from approval
 * ------------------------------------------------------------------ */
console.log("\nExpiry (from the approval date):");
const approval = new Date("2026-10-10T00:00:00.000Z");
eq("free  = +24 hours", calculateExpiryDate("free", approval).toISOString(), "2026-10-11T00:00:00.000Z");
eq("golden = +4 days", calculateExpiryDate("golden", approval).toISOString(), "2026-10-14T00:00:00.000Z");
eq("premium = +7 days", calculateExpiryDate("premium", approval).toISOString(), "2026-10-17T00:00:00.000Z");
eq("expiry labels", [getExpiryLabel("free"), getExpiryLabel("golden"), getExpiryLabel("premium")], ["24 hours", "4 days", "1 week"]);

/*
 * The window must follow the approval date, not creation. An ad that sat in the
 * admin queue for a day used to lose a day of its paid window.
 */
eq("a later approval yields a later expiry",
  calculateExpiryDate("premium", new Date("2026-10-17T00:00:00.000Z")).toISOString(),
  "2026-10-24T00:00:00.000Z");

/* ------------------------------------------------------------------ *
 * 4. Free-ad quota
 * ------------------------------------------------------------------ */
console.log("\nFree-ad quota:");
eq("one live free ad per account", FREE_AD_LIMIT, 1);

/* ------------------------------------------------------------------ *
 * 5. Duplicate detection
 * ------------------------------------------------------------------ */
console.log("\nDuplicate detection:");
eq("punctuation and spacing collapse",
  normalizeForCompare("  Best  Rate -  Mumbai!! "),
  normalizeForCompare("best rate mumbai"));
eq("case folds", normalizeForCompare("BEST RATE"), normalizeForCompare("best rate"));

const base = "young independent escort in mumbai available all night with full service and hotel delivery";
const near = "young independent escort in mumbai available all night with full service and hotel delivery too";
const different = "senior professional companion in delhi for corporate meetings and airport transfers";

check("a re-post with one word added is caught",
  similarity(base, near) >= DUPLICATE_SIMILARITY_THRESHOLD,
  `similarity ${similarity(base, near).toFixed(2)} below ${DUPLICATE_SIMILARITY_THRESHOLD}`);
check("a genuinely different ad is not caught",
  similarity(base, different) < DUPLICATE_SIMILARITY_THRESHOLD,
  `similarity ${similarity(base, different).toFixed(2)} is too high to be a coincidence`);
eq("identical text scores 1", similarity(base, base), 1);
eq("empty text scores 0", similarity("", base), 0);

/* ------------------------------------------------------------------ *
 * 6. The rules are actually wired into the controllers
 * ------------------------------------------------------------------ */
console.log("\nWiring (controllers/productController.js):");
const controller = read("controllers/productController.js");

check("add: duplicate check runs", /findDuplicateAd\(\s*userId/.test(controller),
  "posting without the duplicate check would let a user re-post the same ad");
check("add: contact stripped for free ads", /allowsContact\(adType\)/.test(controller),
  "hiding contact in the UI is not enough; a free ad's number must not be stored");
check("add: image cap enforced", /getMaxImagesForAdType\(adType\)/.test(controller));
check("update: duplicate check runs", /findDuplicateAd\(\s*\n?\s*product\.userId/.test(controller),
  "otherwise the same copy can be duplicated by editing instead of posting");
check("update: contact cleared when downgraded to free",
  /keepsContact\s*\?\s*\(whatsapp/.test(controller),
  "downgrading to free must drop the stored numbers, not just hide them");
check("approval uses the shared expiry helper",
  /expiryDate = calculateExpiryDate\(/.test(controller),
  "a local copy of the window is how the two copies drifted apart before");

const expiry = read("utils/adExpiryChecker.js");
check("expiry job labels come from the shared helper",
  /getExpiryLabel\(/.test(expiry),
  "the email must quote the same window the ad actually got");

const userController = read("controllers/userController.js");
check("welcome coins are a named constant, not a literal",
  /NEW_USER_WELCOME_COINS\s*=\s*100/.test(userController),
  "a bare 1000/100 is the kind of number that gets changed without noticing");
check("welcome coins granted only at signup",
  /coins:\s*NEW_USER_WELCOME_COINS/.test(userController));

/* ------------------------------------------------------------------ *
 * 7. Client mirror
 * ------------------------------------------------------------------ */
console.log("\nClient mirror (frontend-next/src/lib/adRules.js):");
const clientRulesSource = readFileSync(
  join(root, "..", "frontend-next", "src", "lib", "adRules.js"),
  "utf8",
);
for (const [label, pattern] of [
  ["free photo cap", /free:\s*0/],
  ["golden photo cap", /golden:\s*2/],
  ["premium photo cap", /premium:\s*4/],
  ["golden and premium contact", /CONTACT_TYPES\s*=\s*\[[^\]]*"golden"[^\]]*\]/],
  ["premium-only listing buttons", /LISTING_CONTACT_TYPES\s*=\s*\["premium"\]/],
  ["free-ad quota", /FREE_AD_LIMIT\s*=\s*1/],
  ["expiry labels", /free:\s*"24 hours"/],
]) {
  check(`${label} mirrored on the client`, pattern.test(clientRulesSource),
    "the client mirror drifted from the backend rule");
}

console.log(
  failures === 0
    ? "\nAll ad-rule checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);