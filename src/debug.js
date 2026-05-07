import { state } from "./state.js";
import { Button } from "./button.js";
import { game } from "./game.js";

const SHAPE_KINDS = [
	{ name: "Egg", index: 0, unlockKey: null },
	{ name: "Square", index: 1, unlockKey: "squaresUnlocked" },
	{ name: "Triangle", index: 2, unlockKey: "trianglesUnlocked" },
	{ name: "Pentagon", index: 3, unlockKey: "pentagonsUnlocked" },
	{ name: "Hexagon", index: 4, unlockKey: "hexagonsUnlocked" },
	{ name: "Heptagon", index: 5, unlockKey: "heptagonsUnlocked" },
	{ name: "Octagon", index: 6, unlockKey: "octagonsUnlocked" },
	{ name: "Nonagon", index: 7, unlockKey: "nonagonsUnlocked" },
];

function unlockAllShapes() {
	for (const k of SHAPE_KINDS) if (k.unlockKey) state[k.unlockKey] = true;
}

function maxShapeUpgrades(index) {
	state.layersCaps[index] = index === 0 ? 5 : 6;
	state.shapeEvoNerf[index] *= Math.pow(1.25, 10);
	if (index === 1) state.shapeTypeBuff *= Math.pow(1.16, 10);
	if (index === 2) state.shapeTypeBuff *= Math.pow(1.15, 10);
	if (index === 3) state.shapeTypeBuff *= Math.pow(1.14, 10);
}

const DEBUG_COLOR = "#d63a3a";

const actions = [
	{ label: "Score x1000", run: () => { state.score = Math.max(state.score, 1) * 1000; } },
	{ label: "Score x1e9", run: () => { state.score = Math.max(state.score, 1) * 1e9; } },
	{ label: "Unlock All Tabs", run: unlockAllShapes },
	{ label: "Unlock Legendary", run: () => { state.rarityCap = Math.max(state.rarityCap, 1); } },
	{ label: "Max Shape Buffs", run: () => { state.shapeTypeBuff *= 1e6; state.shapeRarityBuff *= 100; } },
	...SHAPE_KINDS.map((k) => ({
		label: "Max " + k.name + " Upgrades",
		run: () => { maxShapeUpgrades(k.index); if (k.unlockKey) state[k.unlockKey] = true; },
	})),
];

const toggleButton = new Button(() => { panelOpen = !panelOpen; }, DEBUG_COLOR);
const actionButtons = actions.map((a) => new Button(a.run, DEBUG_COLOR));
let panelOpen = false;

export function renderDebugPanel(ctx) {
	const s = game.scale;
	const w = 200 * s;
	const h = 40 * s;
	const margin = 6 * s;
	const x = game.width - w - margin;
	let y = margin;
	toggleButton.render(ctx, x, y, w, h, panelOpen ? "DEBUG ▲" : "DEBUG ▼", false);
	if (!panelOpen) return;
	for (let i = 0; i < actions.length; ++i) {
		y += h + 4 * s;
		actionButtons[i].render(ctx, x, y, w, h, actions[i].label, false);
	}
}
