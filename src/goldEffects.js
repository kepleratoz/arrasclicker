import { game } from "./game.js";
import { state } from "./state.js";

// Gold-shape effects: temporary buffs granted when a gold shape is destroyed.
// Base duration 60s, extended +20s per goldEffectExtensionUpgrades level (0-3).
const GOLD_BASE_DURATION_MS = 60000;
function goldDurationMs() {
	return GOLD_BASE_DURATION_MS + (state.goldEffectExtensionUpgrades || 0) * 20000;
}

function addGoldEffect(key, label, mul, overrideMs) {
	const now = performance.now();
	if (!game.goldEffects) game.goldEffects = [];
	const dur = overrideMs != null ? overrideMs : goldDurationMs();
	game.goldEffects.push({ key, label, mul, expiry: now + dur });
}

// Grant the effect(s) tied to a destroyed gold shape's type index.
// 0 Egg, 1 Square, 2 Triangle, 3 Pentagon, 4 Hexagon.
export function grantGoldEffect(type) {
	switch (type) {
		case 0: addGoldEffect("score", "Score", 4); break;
		// Golden Square: 30s flat cost-reduction (NOT affected by the gold-duration upgrade).
		case 1: addGoldEffect("costReduction", "Cost Reduction", 0.5, 30000); break;
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
// Cost reduction stacks multiplicatively (each Golden Square shaves another 50%).
export function goldCostReductionMul() { return activeMul("costReduction"); }
