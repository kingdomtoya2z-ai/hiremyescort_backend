/**
 * Canonical identity helpers used for abuse detection.
 *
 * The important one is `canonicalEmail`. Gmail ignores dots in the local part
 * and everything after a `+`, so all of these are the SAME mailbox:
 *
 *   john.doe@gmail.com
 *   johndoe@gmail.com
 *   john.doe+anything@gmail.com
 *   John.Doe+spam@googlemail.com
 *
 * The old registration check compared the raw string, so one person could
 * register an unlimited number of "unique" accounts from a single inbox. That
 * is how a spammer keeps coming back after an account is deleted.
 *
 * These functions never rewrite the address shown to the user. They produce a
 * comparison value, stored separately as `emailCanonical`.
 */

/** Domains Google treats as the same mailbox. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Canonical, comparison-only form of an email address.
 *
 * Non-Gmail addresses are simply trimmed and lower-cased. We still apply the
 * general lower-casing because every mail provider treats the domain
 * case-insensitively, and most treat the local part that way too.
 */
export const canonicalEmail = (value) => {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (!GMAIL_DOMAINS.has(domain)) return email;

  const withoutTag = local.split("+")[0];
  return `${withoutTag.replace(/\./g, "")}@gmail.com`;
};

/**
 * Comparison form of an Indian phone number.
 *
 * Users type things like "+91 98765 43210", "098765-43210" and
 * "9876543210". All three must compare equal, so keep only the final 10
 * digits. This is intentionally the same storage format as `User.phoneNo`.
 */
export const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

/**
 * The caller's address, with the IPv4-mapped IPv6 prefix removed.
 *
 * `server.js` sets `trust proxy = 1`, so behind Railway's proxy `req.ip` is the
 * real client address rather than the proxy's. Normalising the `::ffff:`
 * prefix means the same visitor cannot produce two different blocklist entries
 * depending on how the connection arrived.
 */
export const getClientIp = (req) => {
  const raw = req?.ip || req?.socket?.remoteAddress || "";
  return String(raw).replace(/^::ffff:/, "").trim();
};

/**
 * MongoDB filter that finds an account by its exact address, its canonical
 * form, or a Gmail dot/+tag alias of it.
 *
 * The exact branch keeps older accounts, created before `emailCanonical`
 * existed, findable. The regex branch is what makes the alias check work
 * BEFORE the backfill has been run: for a canonical local part like `johndoe`
 * it matches `john.doe@`, `j.o.h.n.d.o.e@`, `johndoe+spam@` and the
 * `googlemail.com` spelling, without needing the stored comparison field.
 *
 * Registration volume is low, so this one extra indexed-ish lookup is
 * acceptable on the sign-up path. Everything else (login, password reset)
 * benefits from the same filter.
 */
export const emailLookupFilter = (email) => {
  const raw = String(email || "").trim();
  const canonical = canonicalEmail(raw);

  const or = [{ email: raw }, { emailCanonical: canonical }];

  const at = canonical.lastIndexOf("@");
  const domain = at > 0 ? canonical.slice(at + 1) : "";
  if (GMAIL_DOMAINS.has(domain)) {
    const local = canonical.slice(0, at);
    if (local) {
      const escaped = local
        .split("")
        .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\.?");
      or.push({
        email: {
          $regex: `^${escaped}(\\+[^@]*)?@(gmail\\.com|googlemail\\.com)$`,
          $options: "i",
        },
      });
    }
  }

  return { $or: or };
};
