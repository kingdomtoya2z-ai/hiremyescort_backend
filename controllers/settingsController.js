import {
  getPlatformSettings,
  setWelcomeCoins,
} from "../utils/platformSettings.js";

/**
 * Admin platform settings.
 * GET /api/v1/settings -> { success, settings: { welcomeCoins } }
 * PUT /api/v1/settings/welcome-coins { welcomeCoins }
 */
export const getSettings = async (req, res) => {
  try {
    const settings = await getPlatformSettings();
    return res.status(200).json({
      success: true,
      settings: {
        welcomeCoins: settings.welcomeCoins,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateWelcomeCoins = async (req, res) => {
  try {
    const raw = req.body.welcomeCoins;
    // `Number("50abc")` is NaN, but a loose parse-to-0 helper would silently
    // turn a malformed value into a valid-looking 0, so require a real number.
    const welcomeCoins = Number(raw);

    if (
      raw === null ||
      raw === undefined ||
      String(raw).trim() === "" ||
      !Number.isInteger(welcomeCoins) ||
      welcomeCoins < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Welcome coins must be a whole number of 0 or more",
      });
    }

    const settings = await setWelcomeCoins(welcomeCoins);
    return res.status(200).json({
      success: true,
      message: `New registrations will receive ${welcomeCoins} coins`,
      settings: {
        welcomeCoins: settings.welcomeCoins,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
