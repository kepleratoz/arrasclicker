import { state } from "./state.js";
import { Button, SliderButton, RAINBOW } from "./button.js";
import { colors, formatNumber, darken } from "./utils.js";
import { shapeTypeFromBuff, shapeRarityFromBuff } from "./shape.js";
import { syncTanks } from "./tank.js";
import { goldCostReductionMul } from "./goldEffects.js";
import { keys } from "./input.js";

function shiftHeld() { return keys.pressed.has("ShiftLeft") || keys.pressed.has("ShiftRight"); }

const RARITY_TIER_NAMES = ["Normal", "Shiny", "Legendary", "Shadow", "Rainbow"];
const RARITY_TIER_COLORS = ["#bbbbbb", colors.shiny, colors.legendary, colors.shadow, RAINBOW];
// Force-target type slider (parallel to the rarity cap). The slider index maps to
// state.tankForceTypeCap as (index - 1), so 0=Off (-1), 1=Egg (0), … 5=Hexagon (4).
const FORCE_TYPE_NAMES  = ["Off", "Egg", "Square", "Triangle", "Pentagon", "Hexagon"];
const FORCE_TYPE_COLORS = ["#bbbbbb", colors.egg, colors.square, colors.triangle, colors.pentagon, colors.hexagon];

// ---------- Egg ----------
class EggEvolution {
	button = new Button(() => { state.score -= this.cost(); state.layersCaps[0] += 1; }, colors.egg);
	getLabel() { return "+1 Evolution (" + (state.layersCaps[0] - 1) + "/4)"; }
	cost() { return Math.pow(11, state.layersCaps[0]); }
	getSecondary() { return state.layersCaps[0] >= 5 ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.layersCaps[0] >= 5 || state.score < this.cost(); }
}
class EggEvoTime {
	button = new Button(() => { state.score -= this.cost(); state.eggEvoTimeUpgrades += 1; state.shapeEvoNerf[0] *= 1.25; }, colors.egg);
	getLabel() { return "Decrease Evolution Time (" + formatNumber(state.shapeEvoNerf[0]) + "x less)"; }
	cost() { return Math.round(Math.pow(6, state.eggEvoTimeUpgrades)) + 14; }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
class UnlockSquares {
	button = new Button(() => { state.score -= this.cost(); state.shapeTypeBuff *= 35; state.squaresUnlocked = true; }, colors.square);
	getLabel() { return "Unlock Squares"; }
	cost() { return 5000; }
	getSecondary() { return state.squaresUnlocked ? "UNLOCKED" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.squaresUnlocked || state.score < this.cost(); }
}
export const eggUpgrades = [new EggEvolution(), new EggEvoTime(), new UnlockSquares()];

// ---------- Click ----------
class ClickDamage {
	button = new Button(() => { state.score -= this.cost(); state.clickDamageUpgrades += 1; }, "#3085db");
	getLabel() { return "+1 Click Damage (now " + (1 + state.clickDamageUpgrades) + " per click)"; }
	cost() { return 10 * Math.pow(100, state.clickDamageUpgrades); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
// Lightning is a 4-level upgrade with the same cost ladder as Poison. Each
// level adds +10 % per-click chance to chain lightning to nearby shapes.
const LIGHTNING_COSTS = [3e18, 6e18, 12e18, 24e18];
class LightningUpgrade {
	button = new Button(() => this.activate(), "#f3e96b");
	tall = true;
	level() { return state.lightningLevel || 0; }
	isMaxed() { return this.level() >= LIGHTNING_COSTS.length; }
	isEquipped() { return state.equippedClickUpgrade === "lightning"; }
	nextCost() { return LIGHTNING_COSTS[this.level()] ?? Infinity; }
	activate() {
		// Shift+click toggles equip/unequip (only if owned). Plain click buys
		// the next level if affordable; once maxed a plain click does nothing.
		if (shiftHeld()) {
			if (this.level() <= 0) return;
			state.equippedClickUpgrade = this.isEquipped() ? null : "lightning";
			return;
		}
		if (this.isMaxed()) return;
		const c = this.nextCost();
		if (state.score < c) return;
		state.score -= c;
		state.lightningLevel = this.level() + 1;
		state.lightningOwned = true;
		if (state.lightningLevel === 1) state.equippedClickUpgrade = "lightning";
	}
	getLabel() {
		const lvl = this.level();
		const tag = lvl === 0 ? "" : this.isEquipped() ? " (EQUIPPED)" : " (owned)";
		return "Lightning (" + lvl + "/" + LIGHTNING_COSTS.length + ")" + tag;
	}
	getDescription() {
		const pct = 10 * Math.max(1, this.level());
		return pct + "% chance per click to chain lightning. Shift+click to equip/unequip.";
	}
	getSecondary() {
		if (this.isMaxed()) return this.isEquipped() ? "Shift+click to unequip" : "Shift+click to equip";
		return formatNumber(this.nextCost()) + " score";
	}
	isDisabled() { return !this.isMaxed() && state.score < this.nextCost() && !shiftHeld(); }
}
// Poison is a 4-level upgrade — each purchase grants one extra concurrent
// poison stack per shape (level 1 = 1 stack, level 4 = 4 stacks).
const POISON_COSTS = [1e18, 2e18, 4e18, 8e18];
class PoisonUpgrade {
	button = new Button(() => this.activate(), "#5cd970");
	tall = true;
	level() { return state.poisonLevel || 0; }
	isMaxed() { return this.level() >= POISON_COSTS.length; }
	isEquipped() { return state.equippedClickUpgrade === "poison"; }
	nextCost() { return POISON_COSTS[this.level()] ?? Infinity; }
	activate() {
		if (shiftHeld()) {
			if (this.level() <= 0) return;
			state.equippedClickUpgrade = this.isEquipped() ? null : "poison";
			return;
		}
		if (this.isMaxed()) return;
		const c = this.nextCost();
		if (state.score < c) return;
		state.score -= c;
		state.poisonLevel = this.level() + 1;
		state.poisonOwned = true;
		if (state.poisonLevel === 1) state.equippedClickUpgrade = "poison";
	}
	getLabel() {
		const lvl = this.level();
		const tag = lvl === 0 ? "" : this.isEquipped() ? " (EQUIPPED)" : " (owned)";
		return "Poison (" + lvl + "/" + POISON_COSTS.length + ")" + tag;
	}
	getDescription() {
		const stacks = Math.max(1, this.level());
		return "Clicked shapes take 25% click damage / sec for 10s. Stacks up to " + stacks + "× per shape. Shift+click to equip/unequip.";
	}
	getSecondary() {
		if (this.isMaxed()) return this.isEquipped() ? "Shift+click to unequip" : "Shift+click to equip";
		return formatNumber(this.nextCost()) + " score";
	}
	isDisabled() { return !this.isMaxed() && state.score < this.nextCost() && !shiftHeld(); }
}
// Midas Touch is a 5-level upgrade — the initial purchase counts as the first
// of the 5. Each level doubles the previous level's cost (1e19, 2e19, 4e19,
// 8e19, 16e19). Each level adds +0.1% per-click chance to replace the clicked
// shape with a random gold shape.
const MIDAS_COSTS = [5e18, 10e18, 20e18, 40e18, 80e18];
class MidasUpgrade {
	button = new Button(() => this.activate(), "#d4af37");
	tall = true;   // upgrade panel renders this slot taller with a separate description row.
	level() { return state.midasLevel || 0; }
	isMaxed() { return this.level() >= MIDAS_COSTS.length; }
	isEquipped() { return state.equippedClickUpgrade === "midas"; }
	nextCost() { return MIDAS_COSTS[this.level()] ?? Infinity; }
	activate() {
		if (shiftHeld()) {
			if (this.level() <= 0) return;
			state.equippedClickUpgrade = this.isEquipped() ? null : "midas";
			return;
		}
		if (this.isMaxed()) return;
		const c = this.nextCost();
		if (state.score < c) return;
		state.score -= c;
		state.midasLevel = this.level() + 1;
		state.midasOwned = true;
		if (state.midasLevel === 1) state.equippedClickUpgrade = "midas";
	}
	getLabel() {
		const lvl = this.level();
		const tag = lvl === 0 ? "" : this.isEquipped() ? " (EQUIPPED)" : " (owned)";
		return "Midas Touch (" + lvl + "/" + MIDAS_COSTS.length + ")" + tag;
	}
	getDescription() {
		const pct = (0.1 * this.level()).toFixed(1);
		return pct + "% chance per click to convert into a random gold shape. Shift+click to equip/unequip.";
	}
	getSecondary() {
		if (this.isMaxed()) return this.isEquipped() ? "Shift+click to unequip" : "Shift+click to equip";
		return formatNumber(this.nextCost()) + " score";
	}
	// No cost() method → the upgrade panel won't try to bulk-buy via simulateBuy.
	isDisabled() { return !this.isMaxed() && state.score < this.nextCost() && !shiftHeld(); }
}
export const clickUpgrades = [
	new ClickDamage(),
	new PoisonUpgrade(),
	new LightningUpgrade(),
	new MidasUpgrade(),
];

// ---------- General ----------
class ShapesCap {
	button = new Button(() => { state.score -= this.cost(); state.shapesCap += 1; }, colors.blue);
	getLabel() { return "+1 Shape Cap (" + state.shapesCap + "/100)"; }
	cost() { return Math.pow(10, state.shapesCap - 9); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.shapesCap >= 100 || state.score < this.cost(); }
}
class SpawnInterval {
	button = new Button(() => { state.score -= this.cost(); state.spawnIntervalUpgrades += 1; state.shapesSpawnInterval -= 100; }, colors.blue);
	getLabel() {
		const s = state.shapesSpawnInterval / 1000;
		return "-5% Spawn Interval (" + s.toFixed(2) + "s) (" + state.spawnIntervalUpgrades + "/15)";
	}
	max() { return state.spawnIntervalUpgrades >= 15; }
	cost() { return Math.round(10 * Math.pow(1.5, Math.pow(state.spawnIntervalUpgrades, 1.25))); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
// Opaque "shadow" tone for buttons — translucent fills make the border look
// extra thick (the stroke's inner half shows through), so use a solid dark
// color here while shape rendering keeps the truly translucent colors.shadow.
const SHADOW_BUTTON_COLOR = "#3a3a3a";
// Palette matches the player's highest unlocked rarity so the upgrade button
// stays visually consistent with the actual top-tier they can spawn — including
// the dark shadow tone at tier 2 and the rolling-hue rainbow at tier 3.
const SHINY_PALETTE = [colors.shiny, colors.legendary, SHADOW_BUTTON_COLOR, RAINBOW];
class ShinyChance {
	button = new Button(() => { state.score -= this.cost(); state.shinyChanceUpgrades += 1; state.shapeRarityBuff *= 1.05; }, colors.shiny);
	syncColor() {
		const fill = SHINY_PALETTE[Math.min(SHINY_PALETTE.length - 1, state.rarityCap)];
		this.button.fill = fill;
		this.button.stroke = fill === RAINBOW ? RAINBOW : darken(fill, 0.75);
	}
	getLabel() { return "Increase Rare Shapes Chance (" + formatNumber(state.shapeRarityBuff) + "x more)"; }
	cost() { return 1000 * Math.pow(2, state.shinyChanceUpgrades); }
	getSecondary() { this.syncColor(); return formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost(); }
}
class ExtendGoldenDuration {
	button = new Button(() => { state.score -= this.cost(); state.goldEffectExtensionUpgrades = (state.goldEffectExtensionUpgrades || 0) + 1; }, "#efc74b");
	level() { return state.goldEffectExtensionUpgrades || 0; }
	getLabel() { return "+20s Golden Shape Effect Duration (" + this.level() + "/3, base 60s)"; }
	max() { return this.level() >= 3; }
	cost() { return this.level() >= 3 ? Infinity : 1e17 * Math.pow(5, this.level()); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class ArenaFov {
	button = new Button(() => { state.score -= this.cost(); state.arenaFovUpgrades += 1; }, colors.darkArena);
	getLabel() { return "Increase Arena (" + formatNumber(state.arenaFovUpgrades) + ")"; }
	max() { return state.arenaFovUpgrades >= 1 || state.currentMap === 1; }
	cost() { return Math.pow(1e5, Math.pow(state.arenaFovUpgrades + 1, 3)) * 100; }
	getSecondary() {
		if (state.currentMap === 1) return "Locked on Map 2";
		return this.max() ? "MAX" : formatNumber(this.cost()) + " score.";
	}
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class AddTank {
	button = new Button(() => { state.score -= this.cost(); state.tankCount += 1; syncTanks(); }, "#58b0d0");
	getLabel() { return "Add Tank (" + state.tankCount + "/3)"; }
	requirement() { return state.arenaFovUpgrades >= 1; }
	max() { return state.tankCount >= 3; }
	cost() { return state.tankCount === 0 ? 1e12 : state.tankCount === 1 ? 1e14 : 1e15; }
	getSecondary() {
		if (this.max()) return "MAX";
		if (!this.requirement()) return "Requires Arena Tier 1";
		return formatNumber(this.cost()) + " score.";
	}
	isDisabled() { return this.max() || !this.requirement() || state.score < this.cost(); }
}
// Crash Zone–only 4th-tank slot. Visible only when state.currentMap === 1,
// because tankCount and the bought-flag are per-map fields the upgrade only
// makes sense on that map.
class CrashZoneFourthTank {
	button = new Button(() => {
		state.score -= this.cost();
		state.crashZoneFourthTankBought = true;
		state.tankCount += 1;
		syncTanks();
	}, "#e6373d");
	// Hide entirely outside Crash Zone — both tankCount and crashZoneFourthTankBought
	// are per-map fields so the slot is meaningless on other maps.
	hidden() { return state.currentMap !== 1; }
	getLabel() { return "Add 4th Tank (Crash Zone)"; }
	requirement() { return state.currentMap === 1 && state.tankCount === 3 && !state.crashZoneFourthTankBought; }
	max() { return !!state.crashZoneFourthTankBought; }
	cost() { return 1e19; }
	getSecondary() {
		if (this.max()) return "OWNED";
		if (state.currentMap !== 1) return "Crash Zone only";
		if (state.tankCount < 3) return "Need 3 tanks first";
		return formatNumber(this.cost()) + " score.";
	}
	isDisabled() { return this.max() || !this.requirement() || state.score < this.cost(); }
}
export const generalUpgrades = [new ShapesCap(), new SpawnInterval(), new ShinyChance(), new ExtendGoldenDuration(), new ArenaFov(), new AddTank(), new CrashZoneFourthTank()];

// ---------- Square ----------
class SquareEvolution {
	button = new Button(() => { state.score -= this.cost(); state.layersCaps[1] += 1; }, colors.square);
	getLabel() { return "+1 Evolution (" + (state.layersCaps[1] - 1) + "/5)"; }
	max() { return state.layersCaps[1] > 5; }
	cost() { return Math.pow(7, state.layersCaps[1] + 3); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class SquareEvoTime {
	button = new Button(() => { state.score -= this.cost(); state.squareEvoTimeUpgrades += 1; state.shapeEvoNerf[1] *= 1.5; }, colors.square);
	getLabel() { return "Decrease Evolution Time (" + formatNumber(state.shapeEvoNerf[1]) + "x less)"; }
	requirement() { return state.layersCaps[1] <= 1; }
	cost() { return 1000 * Math.round(Math.pow(6, state.squareEvoTimeUpgrades)); }
	getSecondary() { return formatNumber(this.cost()) + " score" + (this.requirement() ? ". Get first evolution upgrade" : ""); }
	isDisabled() { return this.requirement() || state.score < this.cost(); }
}
class SquareBuff {
	button = new Button(() => { state.score -= this.cost(); state.squareBuffUpgrades += 1; state.shapeTypeBuff *= 1.16; }, colors.square);
	getLabel() { return "Increase Possibility of New Shapes (" + formatNumber(state.shapeTypeBuff) + "x)"; }
	max() { return state.squareBuffUpgrades >= 10; }
	cost() { return Math.round(Math.pow(2, state.squareBuffUpgrades + 12)); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class UnlockTriangles {
	button = new Button(() => { state.trianglesUnlocked = true; }, colors.triangle);
	getLabel() { return "Unlock Triangle Upgrades"; }
	requirement() { return shapeTypeFromBuff(state.shapeTypeBuff) > 3; }
	cost() { return 1e7; }
	getSecondary() {
		if (state.trianglesUnlocked) return "UNLOCKED";
		const needed = Math.pow(5, 3) - 5;   // 120 — where the spawn bucket flips to triangle.
		if (state.shapeTypeBuff < needed) {
			return "Spawn chance: " + formatNumber(Math.floor(state.shapeTypeBuff)) + " / " + formatNumber(needed) + " needed";
		}
		return formatNumber(this.cost()) + " score";
	}
	isDisabled() { return state.trianglesUnlocked || !this.requirement() || state.score < this.cost(); }
}
export const squareUpgrades = [new SquareEvolution(), new SquareEvoTime(), new SquareBuff(), new UnlockTriangles()];

// ---------- Triangle ----------
class TriangleEvolution {
	button = new Button(() => { state.score -= this.cost(); state.layersCaps[2] += 1; }, colors.triangle);
	getLabel() { return "+1 Evolution (" + (state.layersCaps[2] - 1) + "/5)"; }
	max() { return state.layersCaps[2] > 5; }
	cost() { return Math.pow(5, state.layersCaps[2] + 9); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class TriangleEvoTime {
	button = new Button(() => { state.score -= this.cost(); state.triangleEvoTimeUpgrades += 1; state.shapeEvoNerf[2] *= 1.25; }, colors.triangle);
	getLabel() { return "Decrease Evolution Time (" + formatNumber(state.shapeEvoNerf[2]) + "x less)"; }
	cost() { return Math.round(Math.pow(7, state.triangleEvoTimeUpgrades + 5)); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
class TriangleBuff {
	button = new Button(() => { state.score -= this.cost(); state.triangleBuffUpgrades += 1; state.shapeTypeBuff *= 1.15; }, colors.triangle);
	getLabel() { return "Increase Possibility of New Shapes (" + formatNumber(state.shapeTypeBuff) + "x)"; }
	max() { return state.triangleBuffUpgrades >= 10; }
	cost() { return Math.round(Math.pow(2, state.triangleBuffUpgrades + 22)); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class UnlockLegendary {
	button = new Button(() => { state.rarityCap += 1; }, colors.legendary);
	getLabel() { return "Unlock Legendary Rarity"; }
	cost() { return 5e7; }
	requirement() { return shapeRarityFromBuff(state.shapeRarityBuff) > 3; }
	getSecondary() {
		return state.rarityCap > 0
			? "UNLOCKED"
			: formatNumber(this.cost()) + " score and it should be able to spawn.";
	}
	isDisabled() { return state.rarityCap > 0 || !this.requirement() || state.score < this.cost(); }
}
class UnlockPentagons {
	button = new Button(() => { state.shapeTypeBuff *= 10; state.pentagonsUnlocked = true; }, colors.pentagon);
	getLabel() { return "Unlock Pentagon Upgrades"; }
	// Tied to the actual pentagon spawn threshold in randomShapeType (the type
	// bucket starts at shapeTypeFromBuff(buff) > 4, i.e. buff > 620). Pentagons
	// already start rolling naturally once the buff crosses that line — this
	// button just opens the upgrade tab + grants a 10× spawn-rate boost.
	requirement() { return shapeTypeFromBuff(state.shapeTypeBuff) > 4; }
	getSecondary() {
		if (state.pentagonsUnlocked) return "UNLOCKED";
		const needed = Math.pow(5, 4) - 5;   // 620 — where the spawn bucket flips to pentagon.
		return "Spawn chance: " + formatNumber(Math.floor(state.shapeTypeBuff)) + " / " + formatNumber(needed) + " needed";
	}
	isDisabled() { return state.pentagonsUnlocked || !this.requirement(); }
}
export const triangleUpgrades = [
	new TriangleEvolution(),
	new TriangleEvoTime(),
	new TriangleBuff(),
	new UnlockLegendary(),
	new UnlockPentagons(),
];

// ---------- Pentagon ----------
class PentagonEvolution {
	button = new Button(() => { state.score -= this.cost(); state.layersCaps[3] += 1; }, colors.pentagon);
	getLabel() { return "+1 Evolution (" + (state.layersCaps[3] - 1) + "/5)"; }
	max() { return state.layersCaps[3] > 5; }
	cost() { return Math.pow(5, state.layersCaps[3] + 15); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class PentagonEvoTime {
	button = new Button(() => { state.score -= this.cost(); state.pentagonEvoTimeUpgrades += 1; state.shapeEvoNerf[3] *= 1.25; }, colors.pentagon);
	getLabel() { return "Decrease Evolution Time (" + formatNumber(state.shapeEvoNerf[3]) + "x less)"; }
	cost() { return Math.round(Math.pow(8, state.pentagonEvoTimeUpgrades + 8)); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
class PentagonBuff {
	button = new Button(() => { state.score -= this.cost(); state.pentagonBuffUpgrades += 1; state.shapeTypeBuff *= 1.14; }, colors.pentagon);
	getLabel() { return "Increase Possibility of New Shapes (" + formatNumber(state.shapeTypeBuff) + "x)"; }
	max() { return state.pentagonBuffUpgrades >= 10; }
	cost() { return Math.round(Math.pow(2, state.pentagonBuffUpgrades + 32)); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class UnlockHexagons {
	button = new Button(() => { state.hexagonsUnlocked = true; }, colors.hexagon);
	getLabel() { return "Unlock Hexagon Upgrades"; }
	// Gated on spawn-bucket coverage, same shape as the other unlocks but
	// using a fractional threshold so the gate clears after ~6 pentagon-tab
	// chance upgrades from the post-pentagon baseline (6200 × 1.14^6 ≈ 13608,
	// 5 buffs only ≈ 11937, so 6 is the smallest count that clears).
	requirement() { return state.pentagonsUnlocked && shapeTypeFromBuff(state.shapeTypeBuff) > 5.9; }
	getSecondary() {
		if (state.hexagonsUnlocked) return "UNLOCKED";
		if (!state.pentagonsUnlocked) return "Unlock pentagons first";
		const needed = Math.pow(5, 5.9) - 5;   // ≈ 13292
		return "Spawn chance: " + formatNumber(Math.floor(state.shapeTypeBuff)) + " / " + formatNumber(needed) + " needed";
	}
	isDisabled() { return state.hexagonsUnlocked || !this.requirement(); }
}

// ---------- Hexagon ----------
class HexagonEvolution {
	button = new Button(() => { state.score -= this.cost(); state.layersCaps[4] += 1; }, colors.hexagon);
	getLabel() { return "+1 Evolution (" + (state.layersCaps[4] - 1) + "/5)"; }
	max() { return state.layersCaps[4] > 5; }
	cost() { return Math.pow(5, state.layersCaps[4] + 21) / 10; }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class HexagonEvoTime {
	button = new Button(() => { state.score -= this.cost(); state.hexagonEvoTimeUpgrades += 1; state.shapeEvoNerf[4] *= 1.25; }, colors.hexagon);
	getLabel() { return "Decrease Evolution Time (" + formatNumber(state.shapeEvoNerf[4]) + "x less)"; }
	cost() { return Math.round(Math.pow(8, state.hexagonEvoTimeUpgrades + 11) / 10); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
class HexagonBuff {
	button = new Button(() => { state.score -= this.cost(); state.hexagonBuffUpgrades += 1; state.shapeTypeBuff *= 1.13; }, colors.hexagon);
	getLabel() { return "Increase Hexagon Spawn Chance (" + formatNumber(state.shapeTypeBuff) + "x)"; }
	max() { return state.hexagonBuffUpgrades >= 10; }
	cost() { return Math.round(Math.pow(2, state.hexagonBuffUpgrades + 42) / 10); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class UnlockRainbow {
	button = new Button(() => { state.score -= this.cost(); state.rarityCap = Math.max(state.rarityCap, 3); }, RAINBOW);
	getLabel() { return "Unlock Rainbow Rarity"; }
	cost() { return 1e17; }
	// Roll condition: rarity buff must be high enough that rainbow can actually roll.
	requirement() { return state.rarityCap >= 2 && shapeRarityFromBuff(state.shapeRarityBuff) > 5; }
	getSecondary() {
		if (state.rarityCap >= 3) return "UNLOCKED";
		if (!this.requirement()) return state.rarityCap < 2 ? "Unlock shadow first" : "Increase rare shapes chance further";
		return formatNumber(this.cost()) + " score. Rainbow-tier shapes.";
	}
	isDisabled() { return state.rarityCap >= 3 || !this.requirement() || state.score < this.cost(); }
}
export const hexagonUpgrades = [new HexagonEvolution(), new HexagonEvoTime(), new HexagonBuff(), new UnlockRainbow()];

// ---------- Tank ----------
const TANK_COLOR = "#58b0d0";
class TankRarityCap {
	button = new SliderButton(
		RARITY_TIER_NAMES,
		() => state.tankRarityCap,
		(idx) => { state.tankRarityCap = idx; },
		TANK_COLOR,
		RARITY_TIER_COLORS,
	);
	getLabel() {
		return state.tankRarityCap === 0
			? "Target Rarity Cap: FROZEN"
			: "Target Rarity Cap (won't target " + RARITY_TIER_NAMES[state.tankRarityCap] + "+)";
	}
	getSecondary() { return ""; }
	isDisabled() { return false; }
}
class TankForceType {
	// Slider index 0 = Off; 1..5 maps to force-cap shape type 0..4.
	button = new SliderButton(
		FORCE_TYPE_NAMES,
		() => (state.tankForceTypeCap ?? -1) + 1,
		(idx) => { state.tankForceTypeCap = idx - 1; },
		TANK_COLOR,
		FORCE_TYPE_COLORS,
	);
	getLabel() {
		const cap = state.tankForceTypeCap ?? -1;
		if (cap < 0) return "Force-Target Shapes: Off";
		return "Force-Target Shapes: " + FORCE_TYPE_NAMES[cap + 1] + " and below (ignores rarity cap)";
	}
	getSecondary() { return ""; }
	isDisabled() { return false; }
}
// Force-target by tier. Slider index 0 = Off; 1..6 maps to tier threshold 1..6.
// When set, any shape whose layers (tier) ≥ the threshold gets auto-targeted
// no matter what the rarity cap says — effectively "kill anything once it
// reaches tier N".
const FORCE_TIER_NAMES = ["Off", "T1", "T2", "T3", "T4", "T5", "T6"];
const FORCE_TIER_COLORS = ["#bbbbbb", "#7f8a99", "#5cd970", "#3ca4cb", "#8d6adf", "#cc669c", "#efc74b"];
class TankForceTier {
	button = new SliderButton(
		FORCE_TIER_NAMES,
		() => Math.max(0, state.tankForceTierCap ?? -1),
		(idx) => { state.tankForceTierCap = idx === 0 ? -1 : idx; },
		TANK_COLOR,
		FORCE_TIER_COLORS,
	);
	getLabel() {
		const cap = state.tankForceTierCap ?? -1;
		if (cap < 1) return "Force-Target Tier: Off";
		return "Force-Target Tier: T" + cap + " (auto-kills any shape that reaches this tier)";
	}
	getSecondary() { return ""; }
	isDisabled() { return false; }
}
export const tankUpgrades = [new TankRarityCap(), new TankForceType(), new TankForceTier()];

class UnlockShadow {
	button = new Button(() => { state.score -= this.cost(); state.rarityCap = Math.max(state.rarityCap, 2); }, SHADOW_BUTTON_COLOR);
	getLabel() { return "Unlock Shadow Rarity"; }
	cost() { return 5e10; }
	requirement() { return state.rarityCap >= 1 && shapeRarityFromBuff(state.shapeRarityBuff) > 4; }
	getSecondary() {
		if (state.rarityCap >= 2) return "UNLOCKED";
		if (!this.requirement()) return state.rarityCap < 1 ? "Unlock legendary first" : "Increase rare shapes chance further";
		return formatNumber(this.cost()) + " score. 5x rarer than legendary.";
	}
	isDisabled() { return state.rarityCap >= 2 || !this.requirement() || state.score < this.cost(); }
}
export const pentagonUpgrades = [
	new PentagonEvolution(),
	new PentagonEvoTime(),
	new PentagonBuff(),
	new UnlockShadow(),
	new UnlockHexagons(),
];

// Apply Golden Square's cost-reduction multiplier to every upgrade's cost
// methods at module-load time. cost() / nextCost() are the canonical sources
// of truth for both display and the score-deduction inside each callback, so
// wrapping them once here propagates the discount everywhere.
function wrapCostMethods(upgrade) {
	for (const k of ["cost", "nextCost"]) {
		if (typeof upgrade[k] !== "function" || upgrade[k]._goldWrapped) continue;
		const orig = upgrade[k];
		// Round so cost-reduction multipliers (e.g. Golden / Gem Square's 0.5×) never
		// leave fractional values that drag the player's score into decimals.
		const wrapped = function () { return Math.round(orig.call(this) * goldCostReductionMul()); };
		wrapped._goldWrapped = true;
		upgrade[k] = wrapped;
	}
}
// Wrap upgrade callbacks so every actual purchase (score decreased) bumps the
// global purchase counter. Toggle-only callbacks (e.g. equipping a click
// ability after it's owned) don't decrease score, so they're correctly skipped.
function wrapPurchaseCounter(upgrade) {
	const btn = upgrade && upgrade.button;
	if (!btn || typeof btn.callback !== "function" || btn.callback._statWrapped) return;
	const orig = btn.callback;
	const wrapped = function () {
		const before = state.score;
		const result = orig.apply(this, arguments);
		if (state.score < before) state.statUpgradesBought = (state.statUpgradesBought || 0) + 1;
		return result;
	};
	wrapped._statWrapped = true;
	btn.callback = wrapped;
}
for (const list of [eggUpgrades, clickUpgrades, generalUpgrades, squareUpgrades, triangleUpgrades, pentagonUpgrades, hexagonUpgrades, tankUpgrades]) {
	for (const u of list) { wrapCostMethods(u); wrapPurchaseCounter(u); }
}
