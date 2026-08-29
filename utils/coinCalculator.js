/**
 * Calculates coins based on the top-up amount with bonuses
 * - 500rs top-up: 700 coins (40% bonus)
 * - 1000rs top-up: 1500 coins (50% bonus)
 * - Custom amounts: 1rs = 1coin (no bonus)
 *
 * @param {number} amountInPaise - Amount in paise (smallest currency unit)
 * @returns {object} Object with coins and bonus details
 */
export const calculateCoins = (amountInPaise) => {
  const amountInRupees = Math.floor(amountInPaise / 100);

  let coins = 0;
  let bonus = 0;
  let baseCoins = 0;
  let isBonusPackage = false;

  if (amountInRupees === 500) {
    // 500rs package: 700 coins (40% bonus)
    baseCoins = 500;
    bonus = 200;
    coins = 700;
    isBonusPackage = true;
  } else if (amountInRupees === 1000) {
    // 1000rs package: 1500 coins (50% bonus)
    baseCoins = 1000;
    bonus = 500;
    coins = 1500;
    isBonusPackage = true;
  } else {
    // Custom amount: 1rs = 1coin
    coins = amountInRupees;
    baseCoins = amountInRupees;
    bonus = 0;
    isBonusPackage = false;
  }

  return {
    coins,
    baseCoins,
    bonus,
    isBonusPackage,
    amountInRupees,
  };
};
