import { game } from "./game.js";

// Gold-shape effects: temporary buffs granted when a gold shape is destroyed.
// game.goldEffects = [{ key, label, mul, expiry }] (one entry per kill — multiple kills
// stack their multipliers multiplicatively, each with its own expiry).
const GOLD_DURATION_MS = 60000;   // every gold effect lasts 1 minute.

function addGoldEffect(key, label, mul) {
	const now = performance.now();
	if (!game.goldEffects) game.goldEffects = [];
	game.goldEffects.push({ key, label, mul, expiry: now + GOLD_DURATION_MS });
}

// Grant the effect(s) tied to a destroyed gold shape's type index.
// 0 Egg, 1 Square (no effect), 2 Triangle, 3 Pentagon, 4 Hexagon.
export function grantGoldEffect(type) {
	switch (type) {
		case 0: addGoldEffect("score", "Score", 2); break;
		case 2: addGoldEffect("clickDamage", "Click Damage", 7); addGoldEffect("clickScore", "Click Score", 7); break;
		case 3: addGoldEffect("tankDamage", "Tank Damage", 2); addGoldEffect("tankReload", "Tank Reload", 1.5); break;
		case 4: addGoldEffect("rareChance", "Rare Chance", 6); break;
	}
}

// Product of every active stack of the given key. Returns 1 (identity) when nothing active.
function activeMul(key) {
	if (!game.goldEffects) return 1;
	const now = performance.now();
	let m = 1;
	for (const e of game.goldEffects) if (e.key === key && e.expiry > now) m *= e.mul;
	return m;
}

export function goldScoreMul()       { return activeMul("score"); }
export function goldClickDamageMul() { return activeMul("clickDamage"); }
export function goldClickScoreMul()  { return activeMul("clickScore"); }
export function goldTankDamageMul()  { return activeMul("tankDamage"); }
// Reload speed × N → shoot interval ÷ N. Stacks multiplicatively.
export function goldTankReloadMul()  { const m = activeMul("tankReload"); return m === 1 ? 1 : 1 / m; }
export function goldRareChanceMul()  { return activeMul("rareChance"); }
