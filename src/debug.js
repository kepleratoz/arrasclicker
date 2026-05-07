import { state } from "./state.js";
import { Button } from "./button.js";
import { game } from "./game.js";
import { mouse, keys } from "./input.js";
import { Shape, makeShapeData, TYPE_NAMES } from "./shape.js";
import { Vec2 } from "./utils.js";
import { drawText } from "./render.js";

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

function screenScale() { return game.scale * game.room.fov; }

function worldFromMouse() {
	const s = screenScale();
	return new Vec2(mouse.x / s, mouse.y / s);
}

export function shapeUnderMouse() {
	const s = screenScale();
	let best = null;
	let bestDist = Infinity;
	for (const sh of game.shapes) {
		const dx = mouse.x - sh.pos.x * s;
		const dy = mouse.y - sh.pos.y * s;
		const d = Math.sqrt(dx * dx + dy * dy);
		if (d < sh.drawSize * s && d < bestDist) { best = sh; bestDist = d; }
	}
	return best;
}

function spawnAt(typeIndex, pos) {
	const sh = new Shape(pos);
	sh.layers = 1;
	sh.setType(makeShapeData(typeIndex, -1, sh.layers));
	sh.setEvoTime();
	game.shapes.push(sh);
}

const NUMBER_CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

function setMode(mode) {
	game.debugMode = game.debugMode === mode ? null : mode;
	game.debugSelectedShape = null;
}

const DEBUG_COLOR = "#d63a3a";
const MODE_COLOR = "#3a8ed6";

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
const spawnModeBtn = new Button(() => setMode("spawn"), MODE_COLOR);
const upgradeModeBtn = new Button(() => setMode("upgrade"), MODE_COLOR);
const editionModeBtn = new Button(() => setMode("edition"), MODE_COLOR);
const resetButton = new Button(handleReset, "#222222");
let panelOpen = false;

function handleSpawnMode() {
	for (let i = 0; i < 8; ++i) {
		if (keys.justPressed.has(NUMBER_CODES[i])) {
			spawnAt(i, worldFromMouse());
		}
	}
}

function handleSelectMode(applyKey) {
	if (keys.justPressed.has("Escape")) {
		game.debugSelectedShape = null;
		game.debugMode = null;
		return;
	}
	if (mouse.leftClick) {
		game.debugSelectedShape = shapeUnderMouse();
	}
	const sel = game.debugSelectedShape;
	if (!sel) return;
	if (sel.isDead()) { game.debugSelectedShape = null; return; }
	for (let i = 0; i < 9; ++i) {
		if (keys.justPressed.has(NUMBER_CODES[i])) applyKey(sel, i + 1);
	}
}

function applyUpgradeKey(sel, n) {
	if (n > 5) return;
	while (sel.layers < n) sel.evolve();
}

function applyEditionKey(sel, n) {
	if (n > 5) return;
	const rarity = n - 2; // 1=common(-1), 2=shiny(0), 3=legendary(1), 4=shadow(2), 5=ultra(3)
	sel.setType(makeShapeData(sel.type, rarity, sel.layers));
}

let debugVisible = false;

export function updateDebug() {
	if (keys.justPressed.has("KeyF") && !game.debugMode) {
		const answer = prompt("?");
		if (answer === "big") debugVisible = true;
	}
	if (game.debugMode === "spawn") handleSpawnMode();
	else if (game.debugMode === "upgrade") handleSelectMode(applyUpgradeKey);
	else if (game.debugMode === "edition") handleSelectMode(applyEditionKey);
}

let resetClicks = 0;
let resetClickTimer = 0;
function handleReset() {
	const now = performance.now();
	if (now - resetClickTimer > 3000) resetClicks = 0;
	resetClickTimer = now;
	resetClicks += 1;
	if (resetClicks >= 3) {
		try { localStorage.removeItem("arrasclicker_save"); } catch (e) {}
		location.reload();
	}
}
function resetLabel() {
	if (resetClicks === 0) return "Reset Game";
	if (resetClicks === 1) return "Reset Game (2 more)";
	return "Reset Game (1 more!)";
}

export function renderDebugPanel(ctx) {
	if (!debugVisible) return;
	const s = game.scale;
	const w = 200 * s;
	const h = 40 * s;
	const margin = 6 * s;
	const x = game.width - w - margin;
	let y = margin;
	toggleButton.render(ctx, x, y, w, h, panelOpen ? "DEBUG ▲" : "DEBUG ▼", false);
	if (panelOpen) {
		for (let i = 0; i < actions.length; ++i) {
			y += h + 4 * s;
			actionButtons[i].render(ctx, x, y, w, h, actions[i].label, false);
		}
		y += h + 4 * s;
		spawnModeBtn.render(ctx, x, y, w, h, game.debugMode === "spawn" ? "Spawn Mode ✓" : "Spawn Mode", false);
		y += h + 4 * s;
		upgradeModeBtn.render(ctx, x, y, w, h, game.debugMode === "upgrade" ? "Upgrade Mode ✓" : "Upgrade Mode", false);
		y += h + 4 * s;
		editionModeBtn.render(ctx, x, y, w, h, game.debugMode === "edition" ? "Edition Mode ✓" : "Edition Mode", false);
		y += h + 12 * s;
		resetButton.render(ctx, x, y, w, h, resetLabel(), false);
	}

	if (game.debugMode) {
		const banner = game.debugMode === "spawn"
			? "SPAWN MODE — press 1-8 at cursor to spawn"
			: game.debugMode === "upgrade"
			? "UPGRADE MODE — click shape, press 1-5 (tier), ESC to cancel"
			: "EDITION MODE — click shape, press 1-5 (rarity), ESC to cancel";
		drawText(ctx, banner, game.width / 2, 60 * s, false, true, true, 22 * s);
		if ((game.debugMode === "upgrade" || game.debugMode === "edition") && game.debugSelectedShape && !game.debugSelectedShape.isDead()) {
			const sh = game.debugSelectedShape;
			const sc = screenScale();
			ctx.beginPath();
			ctx.arc(sh.pos.x * sc, sh.pos.y * sc, sh.drawSize * sc + 8 * s, 0, Math.PI * 2);
			ctx.strokeStyle = "#fff";
			ctx.lineWidth = 4 * s;
			ctx.stroke();
			drawText(ctx, "Selected: " + TYPE_NAMES[sh.type] + " L" + sh.layers, game.width / 2, 88 * s, false, true, true, 20 * s);
		}
	}
}
