import { state } from "./state.js";
import { Button, SliderButton } from "./button.js";
import { colors, formatNumber } from "./utils.js";
import { shapeTypeFromBuff, shapeRarityFromBuff } from "./shape.js";
import { syncTanks } from "./tank.js";

const RARITY_TIER_NAMES = ["Normal", "Shiny", "Legendary", "Shadow", "Ultra"];
const RARITY_TIER_COLORS = ["#bbbbbb", colors.shiny, colors.legendary, colors.shadow, colors.ultra];

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

// ---------- General ----------
class ShapesCap {
	button = new Button(() => { state.score -= this.cost(); state.shapesCap += 1; }, colors.blue);
	getLabel() { return "+1 Shape Cap (" + state.shapesCap + "/100)"; }
	cost() { return Math.pow(10, state.shapesCap - 9); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.shapesCap >= 100 || state.score < this.cost(); }
}
class SpawnInterval {
	button = new Button(() => { state.score -= this.cost(); state.spawnIntervalUpgrades += 1; state.shapesSpawnInterval /= 1.1; }, colors.blue);
	getLabel() {
		let s = state.shapesSpawnInterval / 1000;
		let formatted;
		if (s < 1) { s = 1 / s; formatted = s.toFixed(2) + "/s"; }
		else formatted = s.toFixed(2) + "s";
		return "-10% Spawn Interval (" + formatted + ")";
	}
	cost() { return Math.round(10 * Math.pow(1.5, Math.pow(state.spawnIntervalUpgrades, 1.25))); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
class ShinyChance {
	button = new Button(() => { state.score -= this.cost(); state.shinyChanceUpgrades += 1; state.shapeRarityBuff *= 1.05; }, colors.shiny);
	getLabel() { return "Increase Rare Shapes Chance (" + formatNumber(state.shapeRarityBuff) + "x more)"; }
	cost() { return 1000 * Math.pow(2, state.shinyChanceUpgrades); }
	getSecondary() { return formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost(); }
}
class ArenaFov {
	button = new Button(() => { state.score -= this.cost(); state.arenaFovUpgrades += 1; }, colors.darkArena);
	getLabel() { return "Increase Arena (" + formatNumber(state.arenaFovUpgrades) + ")"; }
	max() { return state.arenaFovUpgrades >= 1; }
	cost() { return Math.pow(1e5, Math.pow(state.arenaFovUpgrades + 1, 3)) * 100; }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class AddTank {
	button = new Button(() => { state.score -= this.cost(); state.tankCount += 1; syncTanks(); }, "#58b0d0");
	getLabel() { return "Add Tank"; }
	requirement() { return state.arenaFovUpgrades >= 1; }
	max() { return state.tankCount >= 1; }
	cost() { return 1e12; }
	getSecondary() {
		if (this.max()) return "MAX";
		if (!this.requirement()) return "Requires Arena Tier 1";
		return formatNumber(this.cost()) + " score.";
	}
	isDisabled() { return this.max() || !this.requirement() || state.score < this.cost(); }
}
export const generalUpgrades = [new ShapesCap(), new SpawnInterval(), new ShinyChance(), new ArenaFov(), new AddTank()];

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
		return state.trianglesUnlocked
			? "UNLOCKED"
			: formatNumber(this.cost()) + " score. Get enough of chance to spawn the first triangle";
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
	button = new Button(() => { state.pentagonsUnlocked = true; }, colors.pentagon);
	getLabel() { return "Unlock Pentagon Upgrades"; }
	requirement() { return shapeTypeFromBuff(state.shapeTypeBuff) > 4; }
	getSecondary() {
		return state.pentagonsUnlocked
			? "UNLOCKED"
			: "22 max shapes. Get enough of chance to spawn the first pentagon";
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
	requirement() { return shapeTypeFromBuff(state.shapeTypeBuff) > 5; }
	getSecondary() {
		return state.hexagonsUnlocked
			? "UNLOCKED"
			: "Get enough chance to spawn the first hexagon";
	}
	isDisabled() { return state.hexagonsUnlocked || !this.requirement(); }
}
// ---------- Tank ----------
const TANK_COLOR = "#58b0d0";
class TankReload {
	button = new Button(() => { state.score -= this.cost(); state.tankReloadUpgrades += 1; }, TANK_COLOR);
	getLabel() { return "-10% Reload (" + state.tankReloadUpgrades + "/5)"; }
	max() { return state.tankReloadUpgrades >= 5; }
	cost() { return 1e12 * Math.pow(2, state.tankReloadUpgrades); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class TankDamage {
	button = new Button(() => { state.score -= this.cost(); state.tankDamageUpgrades += 1; }, TANK_COLOR);
	getLabel() { return "+0.5 Damage (" + state.tankDamageUpgrades + "/5)"; }
	max() { return state.tankDamageUpgrades >= 5; }
	cost() { return 1e12 * Math.pow(2, state.tankDamageUpgrades); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class TankPenetration {
	button = new Button(() => { state.score -= this.cost(); state.tankPenetrationUpgrades += 1; }, TANK_COLOR);
	getLabel() { return "+1 Penetration, +20% Range (" + state.tankPenetrationUpgrades + "/3)"; }
	max() { return state.tankPenetrationUpgrades >= 3; }
	cost() { return 1e14 * Math.pow(2, state.tankPenetrationUpgrades); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class TankSpeed {
	button = new Button(() => { state.score -= this.cost(); state.tankSpeedUpgrades += 1; }, TANK_COLOR);
	getLabel() { return "+33% Movement Speed (" + state.tankSpeedUpgrades + "/3)"; }
	max() { return state.tankSpeedUpgrades >= 3; }
	cost() { return 1e14 * Math.pow(2, state.tankSpeedUpgrades); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
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
export const tankUpgrades = [new TankReload(), new TankDamage(), new TankPenetration(), new TankSpeed(), new TankRarityCap()];

export const pentagonUpgrades = [
	new PentagonEvolution(),
	new PentagonEvoTime(),
	new PentagonBuff(),
	new UnlockHexagons(),
];
