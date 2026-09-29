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
 * Failed sign-ins: 3 per 15 minutes per IP.
 *
 * `skipSuccessfulRequests` is essential at this limit, not a nicety. Without
 * it a correct sign-in would spend an attempt, and a user who signs in three
 * times in an afternoon would be locked out until the window expired. Only
 * failures accumulate, so the budget is spent by guessing rather than by use.
 *
 * A correct password does count against the separate per-ACCOUNT budget in
 * `ACCOUNT_WINDOWS.login`, which is what stops a distributed attack where every
 * attempt comes from a different address.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  /*
   * Deliberately far above the 3-per-user rule.
   *
   * The limit that actually enforces "three tries" is the per-ACCOUNT budget in
   * `ACCOUNT_WINDOWS.login`. This per-IP limit is a coarse brake on total
   * volume, and it has to be generous: it is shared by everyone behind one
   * address, which on a phone means the whole carrier NAT and in an office the
   * whole building. At 3 it was measured doing exactly what it must not - one
   * person failing three times locked out the unrelated person who dialled next.
   * It is still low enough to stop a single host grinding through passwords.
   */
  limit: 20,
  standardHeaders: drafts,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: reject(
    "Too many failed sign-in attempts from this network. Please wait 15 minutes and try again.",
  ),
});

/**
 * Registrations: 3 per 15 minutes per IP, matching the sign-in limit.
 *
 * `skipSuccessfulRequests` for the same reason as login: a user who has to
 * correct a password mismatch and resubmit should not be treated as an
 * attacker, and a real registration must not consume the allowance that the
 * next attempt needs.
 */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Same reasoning as loginLimiter: the 3-per-user rule is enforced per
  // account, so this stays generous enough not to punish a shared address.
  limit: 20,
  standardHeaders: drafts,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: reject(
    "Too many sign-up attempts from this network. Please wait 15 minutes and try again.",
  ),
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
  /*
   * Kept in step with the per-IP limits above. These are a second, independent
   * budget, so a botnet spreading one attack across thousands of addresses
   * still only gets this many attempts at any single account.
   */
  login: { windowMs: 15 * 60 * 1000, limit: 3 },
  register: { windowMs: 15 * 60 * 1000, limit: 3 },
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
 * @param {"login"|"register"|"otp-verify"|"otp-send"} action
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

    /*
     * Own header namespace, deliberately not `RateLimit-*`.
     *
     * express-rate-limit writes the standard names on the IP limiter that runs
     * straight after this one. Using the same names meant whichever ran last won
     * the header, so a 429 caused by the per-IP limit could report the
     * per-ACCOUNT remaining count, and vice versa - a response whose numbers
     * describe a limit that was not the one that blocked it. Two independent
     * budgets need two independent names.
     */
    const remaining = Math.max(limit - entry.count, 0);
    res.setHeader("X-RateLimit-Account-Limit", limit);
    res.setHeader("X-RateLimit-Account-Remaining", remaining);
    res.setHeader("X-RateLimit-Account-Reset", Math.ceil(entry.resetAt / 1000));

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
