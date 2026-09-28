import rateLimit from "express-rate-limit";

/**
 * Rate limiting.
 *
 * What was wrong with the previous version, in order of how much damage it did:
 *
 * 1. `app.set("trust proxy", ...)` was never set. Behind Railway's reverse proxy
 *    every request arrives from the proxy, so `req.ip` was the SAME value for
 *    every visitor on the internet - all users shared one bucket. Five failed
 *    logins from one attacker locked out the entire site for 15 minutes.
 *    `server.js` now sets it; this module depends on it.
 *
 * 2. `POST /verify` - OTP verification - had no limiter at all. It is a six
 *    digit code with no attempt limit, i.e. unlimited guessing.
 *
 * 3. One shared `authLimiter` budget covered login, register, reverify,
 *    forgot-password, verify-otp and change-password. Asking for a password
 *    reset spent your login attempts.
 *
 * 4. `generalLimiter`, `coinLimiter` and `adLimiter` were exported and never
 *    imported, so nothing outside `userRoute.js` was throttled at all.
 *
 * 5. The response was a bare string. Every other endpoint answers
 *    `{ success: false, message }`, and the client parses exactly that, so a
 *    429 broke its error handling.
 *
 * IP limiting alone is also not enough against credential stuffing: an attacker
 * with a botnet never repeats an IP. `accountLimiter` below adds a second,
 * independent budget keyed on the account being targeted.
 */

/** JSON error shape matching the rest of the API. */
/*
 * No `keyGenerator` is set on any limiter below, so they all use the library's
 * default, which is the correctly IPv6-safe form. Supplying a custom one that
 * returns `req.ip` directly is the classic way to break this on IPv6 - and the
 * per-account limiter does key on a value, but that value is a lower-cased
 * email, never an address.
 */
function reject(message) {
  return (req, res) => {
    res.status(429).json({
      success: false,
      message,
    });
  };
}

const drafts = "draft-7";

/**
 * Whole-API limiter, mounted in `server.js`.
 *
 * Generous, because almost all traffic here is public catalogue reads that are
 * already cached upstream. It exists to stop a runaway client, not to shape
 * normal use.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many requests. Please try again in a few minutes."),
  skip: (req) => req.path === "/cron-job" || req.path === "/prerender",
});

/**
 * Login: 10 per 15 minutes per IP.
 *
 * `skipSuccessfulRequests` is the point. A shared NAT or office IP should not
 * be punished for one person's typos, and a real user who signs in correctly
 * gets their budget back. Only failures accumulate.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: drafts,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: reject(
    "Too many sign-in attempts. Please wait 15 minutes and try again.",
  ),
});

/** Registering is expensive (hash, email, OTP) and rarely retried legitimately. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many accounts created from this network. Try again later."),
});

/**
 * Sending an OTP or a reset link - /reverify and /forgot-password.
 *
 * Tight, because each one sends an email or a WhatsApp message. This is the
 * abuse vector that costs money and annoys real users.
 */
export const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many codes requested. Please wait 15 minutes and try again."),
});

/**
 * Checking an OTP. This one was previously unlimited.
 *
 * Generous enough for a mistyped code, far too few for a 10^6 space to be
 * walked: 10 attempts per 15 minutes is ~28,800/day, so brute force is not a
 * viable route to the code.
 */
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many incorrect codes. Please request a new one."),
});

/** Finishing a reset by setting a new password. */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many password reset attempts. Please try again later."),
});

/** Coin and ad operations, per IP. */
export const coinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many coin operations. Please try again later."),
});

export const adLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: drafts,
  legacyHeaders: false,
  handler: reject("Too many ad operations. Please try again later."),
});

/* ------------------------------------------------------------------ *
 * Per-account limiting
 * ------------------------------------------------------------------ */

/**
 * A second, independent budget keyed on the ACCOUNT rather than the IP.
 *
 * IP limiting cannot see a botnet, and a distributed attack on one account is
 * exactly the case that matters: every request arrives from a fresh address and
 * sails past the per-IP limits. This counts per account, so the attacker's
 * supply of IPs buys them nothing.
 *
 * Deliberately dependency-free and in-process. That is a real limitation - a
 * multi-instance deploy shares nothing, so each instance would allow `limit`
 * attempts - and it is called out here rather than left to be discovered. If
 * this ever runs on more than one instance, move the counter to Mongo, which is
 * already connected.
 */
const ACCOUNT_WINDOWS = {
  login: { windowMs: 15 * 60 * 1000, limit: 10 },
  "otp-verify": { windowMs: 15 * 60 * 1000, limit: 10 },
  "otp-send": { windowMs: 60 * 60 * 1000, limit: 8 },
};

/** action -> Map<accountKey, { count, resetAt }> */
const accountHits = new Map();

// Drop expired entries so the map cannot grow without bound on a long-running
// process. Unref'd so it never holds the event loop open.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [action, entries] of accountHits) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
    if (!entries.size) accountHits.delete(action);
  }
}, 5 * 60 * 1000);
sweeper.unref?.();

/**
 * Limit by the account being targeted.
 *
 * Counts every request, whether or not the account exists, so the limiter
 * cannot be used to discover which emails are registered. The key is
 * lower-cased, so case variants of the same address share a budget.
 *
 * @param {"login"|"otp-verify"|"otp-send"} action
 * @param {(req) => string} getAccount pulls the account identifier off the request
 */
export function accountLimiter(action, getAccount) {
  const { windowMs, limit } = ACCOUNT_WINDOWS[action];

  return (req, res, next) => {
    const raw = getAccount(req);
    const account = String(raw || "").trim().toLowerCase();

    // Nothing to key on - let the handler deal with the missing field rather
    // than rejecting here with a confusing message.
    if (!account) return next();

    const now = Date.now();
    if (!accountHits.has(action)) accountHits.set(action, new Map());
    const entries = accountHits.get(action);

    let entry = entries.get(account);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(account, entry);
    }

    entry.count += 1;

    const remaining = Math.max(limit - entry.count, 0);
    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > limit) {
      const minutes = Math.max(1, Math.ceil((entry.resetAt - now) / 60000));
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        message: `Too many attempts for this account. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      });
    }

    return next();
  };
}

/** Test seam: clears the per-account counters. */
export function _resetAccountLimiter() {
  accountHits.clear();
}
