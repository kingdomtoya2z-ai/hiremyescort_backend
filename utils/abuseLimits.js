/**
 * Limits that decide when a sign-up looks like the same person again.
 *
 * Every value can be overridden with an environment variable, because the
 * right number depends on traffic: a site whose visitors mostly share mobile
 * carrier NAT needs a higher per-IP allowance than one serving home broadband.
 * Set a value to 0 to disable that particular control.
 */

const nonNegativeInt = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Accounts allowed from one IP inside the window below.
 *
 * Five is deliberately not one: families, offices, hostels and mobile carrier
 * NAT all put several genuine users behind one address. It is low enough that
 * the old pattern - dozens of accounts from one connection - is stopped.
 */
export const MAX_ACCOUNTS_PER_IP = nonNegativeInt(
  process.env.MAX_ACCOUNTS_PER_IP,
  5,
);

/** How far back the per-IP account count looks. */
export const SIGNUP_IP_WINDOW_MS =
  nonNegativeInt(process.env.SIGNUP_IP_WINDOW_HOURS, 24) * 60 * 60 * 1000;

/**
 * Number of ads one account may create per hour. A normal advertiser posts
 * once, maybe edits and renews; a burst of listings is the signature of a
 * spam run. Set to 0 to disable.
 */
export const MAX_AD_POSTS_PER_USER_PER_HOUR = nonNegativeInt(
  process.env.MAX_AD_POSTS_PER_USER_PER_HOUR,
  5,
);

/** Number of ads one account may create per day. */
export const MAX_AD_POSTS_PER_USER_PER_DAY = nonNegativeInt(
  process.env.MAX_AD_POSTS_PER_USER_PER_DAY,
  15,
);
