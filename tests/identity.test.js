/**
 * Identity and spam-detection tests.
 *
 * No framework and no database: the pure helpers are imported directly. These
 * cover the two things that made the spam problem possible - Gmail aliases
 * being treated as different accounts, and duplicate checks only looking at
 * one account at a time.
 */
import {
  canonicalEmail,
  emailLookupFilter,
  normalizePhone,
  getClientIp,
} from "../utils/identity.js";
import { buildSpamClusters } from "../services/spamService.js";
import { buildCrossAccountQuery, normalizeForCompare } from "../utils/adValidation.js";

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
  check(
    label,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );

console.log("\nCanonical Gmail addresses:");
eq("dots and +tag fold", canonicalEmail(" John.Doe+spam@Gmail.com "), "johndoe@gmail.com");
eq("googlemail is gmail", canonicalEmail("john.doe@googlemail.com"), "johndoe@gmail.com");
eq("plain address folds", canonicalEmail("john.doe@gmail.com"), canonicalEmail("johndoe@gmail.com"));
eq("case folds", canonicalEmail("A.B@GMAIL.COM"), "ab@gmail.com");
eq("non-gmail keeps its +tag", canonicalEmail("john+tag@example.com"), "john+tag@example.com");
eq("empty stays empty", canonicalEmail(""), "");
eq("invalid has no crash", canonicalEmail(null), "");

console.log("\nEmail lookup filter:");
const lookup = emailLookupFilter("john.doe+spam@gmail.com");
check(
  "exact and canonical branches are present",
  lookup.$or.some((clause) => clause.emailCanonical === "johndoe@gmail.com"),
);
const aliasClause = lookup.$or.find((clause) => clause.email?.$regex);
const aliasRegex = aliasClause
  ? new RegExp(aliasClause.email.$regex, aliasClause.email.$options)
  : null;
check("legacy alias regex is generated", Boolean(aliasRegex));
check(
  "regex matches a dotted googlemail alias",
  aliasRegex?.test("j.o.h.n.d.o.e+anything@googlemail.com"),
);
check(
  "regex does not match a different mailbox",
  aliasRegex ? !aliasRegex.test("janedoe@gmail.com") : false,
);

console.log("\nPhone normalisation:");
eq("+91 and spaces", normalizePhone("+91 98765 43210"), "9876543210");
eq("leading zero and dashes", normalizePhone("098765-43210"), "9876543210");
eq("already normal", normalizePhone("9876543210"), "9876543210");
eq("empty is empty", normalizePhone(""), "");
eq("short value is preserved", normalizePhone("123"), "123");

console.log("\nClient IP:");
eq("IPv4-mapped IPv6 is unwrapped", getClientIp({ ip: "::ffff:1.2.3.4" }), "1.2.3.4");
eq("plain IPv6 is preserved", getClientIp({ ip: "2001:db8::1" }), "2001:db8::1");
eq("socket fallback", getClientIp({ socket: { remoteAddress: "5.6.7.8" } }), "5.6.7.8");
eq("missing request is safe", getClientIp(undefined), "");

console.log("\nCross-account query:");
const title = "Beautiful independent companion in Mumbai";
const titleQuery = buildCrossAccountQuery("user-1", { title });
check("same title produces a query", Boolean(titleQuery));
check(
  "query targets another account",
  titleQuery?.userId?.$ne === "user-1",
  "the current account must be excluded",
);
check(
  "query uses the normalised title",
  titleQuery?.$or?.some((clause) => clause.titleNormalized === normalizeForCompare(title)),
);
check(
  "query keeps the legacy raw-title fallback",
  titleQuery?.$or?.some((clause) => Boolean(clause.title?.$regex)),
);

const phoneQuery = buildCrossAccountQuery("user-1", {
  title: "Different title",
  contact: "+91 98765 43210",
  whatsapp: "9876543210",
});
check(
  "same contact number produces a query",
  phoneQuery?.$or?.some((clause) => clause.contactNormalized?.$in?.includes("9876543210")),
);

const excluded = buildCrossAccountQuery("user-1", { title }, "ad-1");
eq("exclude id is set", excluded?._id?.$ne, "ad-1");
eq("nothing to compare returns null", buildCrossAccountQuery("user-1", {}), null);

console.log("\nSpam clusters:");
const createdAt = new Date("2026-11-01T00:00:00.000Z");
const users = [
  {
    _id: "u1",
    email: "john.doe@gmail.com",
    emailCanonical: "johndoe@gmail.com",
    phoneNo: "9876543210",
    signupIp: "1.2.3.4",
    createdAt,
  },
  {
    _id: "u2",
    email: "johndoe@gmail.com",
    emailCanonical: "johndoe@gmail.com",
    phoneNo: "9999999999",
    signupIp: "5.6.7.8",
    createdAt,
  },
  {
    _id: "u3",
    email: "third@gmail.com",
    emailCanonical: "third@gmail.com",
    phoneNo: "8888888888",
    signupIp: "9.9.9.9",
    createdAt,
  },
  {
    _id: "u4",
    email: "fourth@gmail.com",
    emailCanonical: "fourth@gmail.com",
    phoneNo: "7777777777",
    signupIp: "9.9.9.9",
    createdAt,
  },
  {
    _id: "u5",
    email: "alone@gmail.com",
    emailCanonical: "alone@gmail.com",
    phoneNo: "6666666666",
    signupIp: "4.4.4.4",
    createdAt,
  },
];

const sharedTitle = "Beautiful independent companion in Mumbai";
const products = [
  { userId: "u3", title: sharedTitle, titleNormalized: normalizeForCompare(sharedTitle) },
  { userId: "u4", title: sharedTitle, titleNormalized: normalizeForCompare(sharedTitle) },
  { userId: "u5", title: "Completely different listing", titleNormalized: normalizeForCompare("Completely different listing") },
];

const clusters = buildSpamClusters({ users, products });
eq("two clusters found", clusters.length, 2);

const emailCluster = clusters.find((cluster) =>
  cluster.users.some((user) => user._id === "u1"),
);
check("alias accounts are grouped", Boolean(emailCluster));
check(
  "alias cluster contains both accounts",
  emailCluster?.users.map((user) => user._id).sort().join(",") === "u1,u2",
);
check(
  "email alias is reported as a signal",
  emailCluster?.signals.some((signal) => signal.label.includes("Gmail")),
);

const titleCluster = clusters.find((cluster) =>
  cluster.users.some((user) => user._id === "u3"),
);
check("same-title accounts are grouped", Boolean(titleCluster));
check(
  "title cluster contains both ad owners",
  titleCluster?.users.map((user) => user._id).sort().join(",") === "u3,u4",
);
check(
  "shared IP is reported too",
  titleCluster?.signals.some((signal) => signal.key === "ip:9.9.9.9"),
);
check(
  "unrelated account is not pulled in",
  !clusters.some((cluster) => cluster.users.some((user) => user._id === "u5")),
);

console.log(
  failures === 0
    ? "\nAll identity checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);
