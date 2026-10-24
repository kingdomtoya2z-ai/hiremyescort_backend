import { Settings, DEFAULT_WELCOME_COINS } from "../models/settingsModel.js";

/** The singleton settings document id. */
const SETTINGS_KEY = "platform";

/**
 * Read the platform settings, creating the singleton with defaults if it does
 * not exist yet. Used by the admin screen.
 */
export const getPlatformSettings = async () => {
  const existing = await Settings.findOne({ key: SETTINGS_KEY });
  if (existing) return existing;

  return Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { welcomeCoins: DEFAULT_WELCOME_COINS } },
    { new: true, upsert: true },
  );
};

/**
 * Coins to grant on signup.
 *
 * Registration must never fail because the settings document is missing or the
 * read blips, so any failure falls back to the built-in default (which matches
 * the schema default). An admin-set 0 is a valid value and is preserved.
 */
export const getWelcomeCoins = async () => {
  try {
    const settings = await Settings.findOne({ key: SETTINGS_KEY })
      .select("welcomeCoins")
      .lean();
    const value = Number(settings?.welcomeCoins);
    return Number.isInteger(value) && value >= 0
      ? value
      : DEFAULT_WELCOME_COINS;
  } catch (error) {
    console.error(
      "Could not read welcome-coin setting, using default:",
      error.message,
    );
    return DEFAULT_WELCOME_COINS;
  }
};

/** Persist a new signup bonus. `welcomeCoins` must already be validated. */
export const setWelcomeCoins = async (welcomeCoins) => {
  return Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { welcomeCoins } },
    { new: true, upsert: true, runValidators: true },
  );
};
