import { cards, categories, tiers, rarities } from './data.js';

const rarityIds = rarities.map(({ id }) => id);
const UINT32_RANGE = 0x100000000;

export function getTier(tierId) {
  const tier = tiers.find(({ id }) => id === tierId);
  if (!tier) throw new RangeError(`Unknown pack tier: ${String(tierId)}`);
  return tier;
}

export function getCategory(categoryId) {
  const category = categories.find(({ id }) => id === categoryId);
  if (!category) throw new RangeError(`Unknown card category: ${String(categoryId)}`);
  return category;
}

export function getPool({ categoryId, tierId, rarity } = {}) {
  getCategory(categoryId);
  getTier(tierId);
  if (rarity !== undefined && !rarityIds.includes(rarity)) {
    throw new RangeError(`Unknown card rarity: ${String(rarity)}`);
  }
  return cards.filter(card => card.category === categoryId
    && card.tierId === tierId && (rarity === undefined || card.rarity === rarity));
}

function randomInteger(max, rng) {
  if (rng !== undefined) {
    if (typeof rng !== 'function') throw new TypeError('rng must be a function.');
    const value = rng();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('rng must return a finite number from 0 (inclusive) to 1 (exclusive).');
    }
    return Math.floor(value * max);
  }

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure randomness is unavailable. Open the demo in a supported browser.');
  }
  // Rejection sampling avoids the modulo bias of reducing all 2^32 values.
  const limit = Math.floor(UINT32_RANGE / max) * max;
  const buffer = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % max;
}

/**
 * Draw rarity using the tier's published percentages, then choose uniformly
 * within that category/tier/rarity pool. No value is changed after selection.
 * rng is an optional deterministic test source; production uses Web Crypto.
 */
export function drawCard({ categoryId, tierId, rng } = {}) {
  getCategory(categoryId);
  const tier = getTier(tierId);
  const totalWeight = rarityIds.reduce((sum, id) => sum + tier.odds[id], 0);
  let roll = randomInteger(totalWeight, rng);
  let selectedRarity;

  for (const rarity of rarityIds) {
    if (roll < tier.odds[rarity]) {
      selectedRarity = rarity;
      break;
    }
    roll -= tier.odds[rarity];
  }

  const pool = getPool({ categoryId, tierId, rarity: selectedRarity });
  if (pool.length === 0) throw new Error('This demo pool has no eligible cards.');
  return pool[randomInteger(pool.length, rng)];
}

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

export function formatMoney(value) {
  return moneyFormatter.format(value);
}
