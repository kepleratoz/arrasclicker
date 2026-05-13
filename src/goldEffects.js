import { game } from "./game.js";

// Gold-shape effects: temporary buffs granted when a gold shape is destroyed.
// game.goldEffects = [{ key, label, expiry }] (initialized in Game constructor; not persisted).
const GOLD_DURATION_MS = 60000;   // every gold effect lasts 1 minute.

function addGoldEffect(key, label) {
	const now = performance.now();
	game.goldEffects = (game.goldEffects ?? []).filter((e) => e.key !== key);
	game.goldEffects.push({ key, label, expiry: now + GOLD_DURATION_MS });
}

// Grant the effect(s) tied to a destroyed gold shape's type index.
// 0 Egg, 1 Square (no effect), 2 Triangle, 3 Pentagon, 4 Hexagon.
export function grantGoldEffect(type) {
	switch (type) {
		case 0: addGoldEffect("score", "2x Score"); break;
		case 2: addGoldEffect("clickDamage", "7x Click Damage"); addGoldEffect("clickScore", "7x Click Score"); break;
		case 3: addGoldEffect("tankDamage", "2x Tank Damage"); addGoldEffect("tankReload", "1.5x Tank Reload"); break;
		case 4: addGoldEffect("rareChance", "6x Rare Chance"); break;
	}
}

function hasGoldEffect(key) {
	if (!game.goldEffects) return false;
	const now = performance.now();
	return game.goldEffects.some((e) => e.key === key && e.expiry > now);
}

export function goldScoreMul()       { return hasGoldEffect("score") ? 2 : 1; }
export function goldClickDamageMul() { return hasGoldEffect("clickDamage") ? 7 : 1; }
export function goldClickScoreMul()  { return hasGoldEffect("clickScore") ? 7 : 1; }
export function goldTankDamageMul()  { return hasGoldEffect("tankDamage") ? 2 : 1; }
// 1.5× reload speed → shoot interval is divided by 1.5.
export function goldTankReloadMul()  { return hasGoldEffect("tankReload") ? 1 / 1.5 : 1; }
export function goldRareChanceMul()  { return hasGoldEffect("rareChance") ? 6 : 1; }
