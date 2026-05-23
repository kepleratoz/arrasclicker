export const state = {
	score: 0,
	spawnIntervalUpgrades: 0,
	squareBuffUpgrades: 0,
	triangleBuffUpgrades: 0,
	shinyChanceUpgrades: 0,
	eggEvoTimeUpgrades: 0,
	squareEvoTimeUpgrades: 0,
	triangleEvoTimeUpgrades: 0,
	pentagonBuffUpgrades: 0,
	pentagonEvoTimeUpgrades: 0,
	hexagonBuffUpgrades: 0,
	hexagonEvoTimeUpgrades: 0,
	arenaFovUpgrades: 0,
	tankCount: 0,
	clickDamageUpgrades: 0,
	lightningOwned: false,
	poisonOwned: false,
	midasOwned: false,
	midasLevel: 0,            // 0 = not owned, 1..4 = each level adds +0.1% conversion chance.
	equippedClickUpgrade: null,   // null | "lightning" | "poison" | "midas"
	lightningClickCount: 0,       // every 3rd click triggers the chain.
	tankRarityCap: 4,
	tankForceTypeCap: -1,        // -1 = off; 0..4 = always-target Egg..Hexagon regardless of rarity.
	tankForceRarityCap: -1,      // -1 = off; 0..4 = always-target Shiny..Ethereal of any type.
	tankFilterOrder: [0, 1, 2],  // display order of the targeting filters in the Tank tab.
	goldEffectExtensionUpgrades: 0,   // 0..3 → +0/+20/+40/+60s to gold-effect duration.
	tanks: [],
	shapeDeathAnimEnabled: true,
	bulletDeathAnimEnabled: true,
	damageBlendEnabled: false,
	shapeSpawningEnabled: true,
	rarityCap: 0,
	shapesSpawnInterval: 2000,
	shapeTypeBuff: 1,
	shapeRarityBuff: 1,
	shapeEvoNerf: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
	layersBuff: 0,
	shapesCap: 10,
	layersCaps: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
	squaresUnlocked: false,
	trianglesUnlocked: false,
	pentagonsUnlocked: false,
	hexagonsUnlocked: false,
	// Map system: state.currentMap is the active map index (0 = base, 1 = unlocked 5x map).
	// state.maps[i] stores a plain snapshot of per-map fields for the inactive map.
	currentMap: 0,
	map1Unlocked: false,
	maps: [null, null],
};

// Fields that are unique to each map. Everything else (arenaFovUpgrades, shapesCap,
// spawnIntervalUpgrades, shinyChanceUpgrades, tankCount, shapeRarityBuff, the toggle
// flags) is shared across maps. The user retains those "General" upgrades after
// unlocking map 1 and must rebuild the rest from scratch.
export const PER_MAP_FIELDS = [
	"score", "clickDamageUpgrades", "tankCount",
	"squareBuffUpgrades", "triangleBuffUpgrades", "pentagonBuffUpgrades", "hexagonBuffUpgrades",
	"eggEvoTimeUpgrades", "squareEvoTimeUpgrades", "triangleEvoTimeUpgrades", "pentagonEvoTimeUpgrades", "hexagonEvoTimeUpgrades",
	"lightningOwned", "poisonOwned", "midasOwned", "midasLevel", "equippedClickUpgrade", "lightningClickCount",
	"tankRarityCap", "tankForceTypeCap", "tankForceRarityCap",
	"shapeTypeBuff", "shapeEvoNerf", "layersBuff", "layersCaps", "rarityCap",
	"squaresUnlocked", "trianglesUnlocked", "pentagonsUnlocked", "hexagonsUnlocked",
];

export function freshMapState() {
	return {
		score: 0, clickDamageUpgrades: 0, tankCount: 0,
		squareBuffUpgrades: 0, triangleBuffUpgrades: 0, pentagonBuffUpgrades: 0, hexagonBuffUpgrades: 0,
		eggEvoTimeUpgrades: 0, squareEvoTimeUpgrades: 0, triangleEvoTimeUpgrades: 0,
		pentagonEvoTimeUpgrades: 0, hexagonEvoTimeUpgrades: 0,
		lightningOwned: false, poisonOwned: false, midasOwned: false, midasLevel: 0,
		equippedClickUpgrade: null, lightningClickCount: 0,
		tankRarityCap: 4, tankForceTypeCap: -1, tankForceRarityCap: -1,
		shapeTypeBuff: 1,
		shapeEvoNerf: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
		layersBuff: 0,
		layersCaps: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
		rarityCap: 0,
		squaresUnlocked: false, trianglesUnlocked: false,
		pentagonsUnlocked: false, hexagonsUnlocked: false,
		tanks: [],
	};
}

export const MAP_SCALES = [1, 5];
