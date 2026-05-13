import { state } from "./state.js";
import { Button, SliderButton } from "./button.js";
import { colors, formatNumber } from "./utils.js";
import { shapeTypeFromBuff, shapeRarityFromBuff } from "./shape.js";
import { syncTanks } from "./tank.js";

const RARITY_TIER_NAMES = ["Normal", "Shiny", "Legendary", "Shadow", "Rainbow"];
const RARITY_TIER_COLORS = ["#bbbbbb", colors.shiny, colors.legendary, colors.shadow, "#ff5cd4"];
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
	cost() { return 100 * Math.pow(1e4, state.clickDamageUpgrades); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
export const clickUpgrades = [new ClickDamage()];

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
	button = new Button(() => { state.shapeTypeBuff *= 10; state.pentagonsUnlocked = true; }, colors.pentagon);
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
	requirement() { return state.pentagonsUnlocked; }
	getSecondary() {
		return state.hexagonsUnlocked
			? "UNLOCKED"
			: this.requirement()
			? "Hexagons now spawn at 1/5 the pentagon rate"
			: "Unlock pentagons first";
	}
	isDisabled() { return state.hexagonsUnlocked || !this.requirement(); }
}

// ---------- Hexagon ----------
class HexagonEvolution {
	button = new Button(() => { state.score -= this.cost(); state.layersCaps[4] += 1; }, colors.hexagon);
	getLabel() { return "+1 Evolution (" + (state.layersCaps[4] - 1) + "/5)"; }
	max() { return state.layersCaps[4] > 5; }
	cost() { return Math.pow(5, state.layersCaps[4] + 21); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score"; }
	isDisabled() { return this.max() || state.score < this.cost(); }
}
class HexagonEvoTime {
	button = new Button(() => { state.score -= this.cost(); state.hexagonEvoTimeUpgrades += 1; state.shapeEvoNerf[4] *= 1.25; }, colors.hexagon);
	getLabel() { return "Decrease Evolution Time (" + formatNumber(state.shapeEvoNerf[4]) + "x less)"; }
	cost() { return Math.round(Math.pow(8, state.hexagonEvoTimeUpgrades + 11)); }
	getSecondary() { return formatNumber(this.cost()) + " score"; }
	isDisabled() { return state.score < this.cost(); }
}
class HexagonBuff {
	button = new Button(() => { state.score -= this.cost(); state.hexagonBuffUpgrades += 1; state.shapeTypeBuff *= 1.13; }, colors.hexagon);
	getLabel() { return "Increase Hexagon Spawn Chance (" + formatNumber(state.shapeTypeBuff) + "x)"; }
	max() { return state.hexagonBuffUpgrades >= 10; }
	cost() { return Math.round(Math.pow(2, state.hexagonBuffUpgrades + 42)); }
	getSecondary() { return this.max() ? "MAX" : formatNumber(this.cost()) + " score."; }
	isDisabled() { return state.score < this.cost() || this.max(); }
}
class UnlockRainbow {
	button = new Button(() => { state.score -= this.cost(); state.rarityCap = Math.max(state.rarityCap, 3); }, "#ff5cd4");
	getLabel() { return "Unlock Rainbow Rarity"; }
	cost() { return 1e19; }
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
export const tankUpgrades = [new TankRarityCap(), new TankForceType()];

class UnlockShadow {
	button = new Button(() => { state.score -= this.cost(); state.rarityCap = Math.max(state.rarityCap, 2); }, colors.shadow, "rgba(34,34,34,0.4)");
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
