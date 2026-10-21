export const rarities = Object.freeze([
  Object.freeze({ id: 'common', label: 'Collector', color: '#67e8c0' }),
  Object.freeze({ id: 'rare', label: 'Rare hit', color: '#a78bfa' }),
  Object.freeze({ id: 'legendary', label: 'Grail', color: '#f5c76b' }),
]);

export const categories = Object.freeze([
  Object.freeze({ id: 'tcg', label: 'Pokémon', description: 'Holographic favorites, memorable promos, and iconic Pokémon.' }),
  Object.freeze({ id: 'sports', label: 'Sports', description: 'Breakout rookies, career moments, and legendary performances.' }),
  Object.freeze({ id: 'classics', label: 'Vintage Pokémon', description: 'First editions and familiar favorites from the early years.' }),
]);

export const tiers = Object.freeze([
  Object.freeze({
    id: 'starter', name: 'Starter', price: 25, floor: 10, ceiling: 150,
    color: '#67e8c0', tagline: 'Every collection starts somewhere.',
    odds: Object.freeze({ common: 80, rare: 18, legendary: 2 }),
  }),
  Object.freeze({
    id: 'silver', name: 'Silver', price: 50, floor: 25, ceiling: 350,
    color: '#c8d6ed', tagline: 'A little more chase. A little more shine.',
    odds: Object.freeze({ common: 75, rare: 20, legendary: 5 }),
  }),
  Object.freeze({
    id: 'gold', name: 'Gold', price: 100, floor: 50, ceiling: 1000,
    color: '#f5c76b', tagline: 'For the moments you sleeve twice.',
    odds: Object.freeze({ common: 70, rare: 24, legendary: 6 }),
  }),
  Object.freeze({
    id: 'sapphire', name: 'Sapphire', price: 250, floor: 125, ceiling: 2500,
    color: '#b7a3ff', tagline: 'The top shelf is calling.',
    odds: Object.freeze({ common: 65, rare: 27, legendary: 8 }),
  }),
]);

// Real photo identities and visible grades. Source information is recorded in
// assets/slabs.json. These are reference images, not physical demo inventory.
const sources = {
  'gengar-1999': {
    name: 'Gengar Holo', set: 'Fossil · 1st Edition', year: 1999, grade: 10,
    image: './assets/gengar-1999-psa.jpg', artTheme: 'gengar', accent: '#b1a0ff',
  },
  'rayquaza-ex-2006': {
    name: 'Rayquaza ex', set: 'Black Star Promos', year: 2006, grade: 10,
    image: './assets/rayquaza-ex-2006-psa.jpg', artTheme: 'rayquaza', accent: '#9cdb86',
  },
  'shining-mew-2001': {
    name: 'Shining Mew', set: 'CoroCoro Comics Promo', year: 2001, grade: 10,
    image: './assets/shining-mew-2001-psa.jpg', artTheme: 'mew', accent: '#83baff',
  },
  'pikachu-gold-star-2006': {
    name: 'Pikachu Gold Star', set: 'EX Holon Phantoms', year: 2006, grade: 9,
    image: './assets/pikachu-gold-star-2006-psa.jpg', artTheme: 'pikachu', accent: '#f3c879',
  },
  'charizard-1999': {
    name: 'Charizard Holo', set: 'Base Set · 1st Edition', year: 1999, grade: 9,
    image: './assets/charizard-1999-psa.jpg', artTheme: 'charizard', accent: '#ffad72',
  },
  'patrick-mahomes-2022': {
    name: 'Patrick Mahomes II', set: 'Mosaic · Genesis', year: 2022, grade: 10,
    image: './assets/patrick-mahomes-mosaic-2022-psa.jpg', artTheme: 'football', accent: '#e9a65c',
  },
  'bryce-young-2025': {
    name: 'Bryce Young', set: 'Donruss · Bomb Squad', year: 2025, grade: 10,
    image: './assets/bryce-young-donruss-2025-psa.jpg', artTheme: 'football', accent: '#83baff',
  },
  'emeka-egbuka-2024': {
    name: 'Emeka Egbuka', set: 'Select · #513', year: 2024, grade: 10,
    image: './assets/emeka-egbuka-select-2024-psa.jpg', artTheme: 'football', accent: '#f3b174',
  },
  'raichu-fossil-1999': {
    name: 'Raichu Holo', set: 'Fossil · 1st Edition', year: 1999, grade: 8,
    image: './assets/raichu-fossil-1999-psa.jpg', artTheme: 'raichu', accent: '#f2bd7a',
  },
  'dark-gyarados-2000': {
    name: 'Dark Gyarados', set: 'Team Rocket · 1st Edition', year: 2000, grade: 10,
    image: './assets/dark-gyarados-rocket-2000-psa.jpg', artTheme: 'gyarados', accent: '#8ac4ec',
  },
};

const categorySources = {
  tcg: ['gengar-1999', 'rayquaza-ex-2006', 'shining-mew-2001', 'pikachu-gold-star-2006'],
  sports: ['bryce-young-2025', 'emeka-egbuka-2024', 'patrick-mahomes-2022'],
  classics: ['raichu-fossil-1999', 'dark-gyarados-2000', 'charizard-1999'],
};

// Each row is an explicit demo value for common / rare / legendary in one tier.
// These illustrative values are not market prices or offers. A reference photo
// can appear in multiple demo pools; no card is promised, sold, or redeemable.
const poolValues = {
  tcg: [[10, 45, 150], [25, 95, 350], [50, 240, 1000], [125, 650, 2500]],
  sports: [[10, 50, 150], [25, 110, 350], [50, 275, 1000], [125, 800, 2500]],
  classics: [[10, 40, 150], [25, 100, 350], [50, 225, 1000], [125, 700, 2500]],
};

export const cards = Object.freeze(categories.flatMap(category => tiers.flatMap((tier, tierIndex) =>
  rarities.map((rarity, rarityIndex) => {
    const index = tierIndex * rarities.length + rarityIndex;
    const sourceIds = categorySources[category.id];
    const sourceId = sourceIds[index % sourceIds.length];
    return Object.freeze({
      ...sources[sourceId], sourceId,
      id: `${category.id}-${String(index + 1).padStart(2, '0')}`,
      category: category.id, tierId: tier.id, rarity: rarity.id,
      value: poolValues[category.id][tierIndex][rarityIndex],
      grader: 'PSA', serial: 'DEMO PHOTO', edition: 'REFERENCE PHOTO',
      valueIsIllustrative: true,
      sourcePage: 'https://powerpacks.gamestop.com/',
    });
  }))));
