import { state } from "./state.js";
import { Button } from "./button.js";
import { game } from "./game.js";
import { mouse, keys } from "./input.js";
import { Shape, Sentry, makeShapeData, TYPE_NAMES } from "./shape.js";
import { Siege } from "./siege.js";
import { resetGame } from "./save.js";
import { Vec2 } from "./utils.js";
import { drawText } from "./render.js";

const SHAPE_KINDS = [
	{ name: "Egg", index: 0, unlockKey: null },
	{ name: "Square", index: 1, unlockKey: "squaresUnlocked" },
	{ name: "Triangle", index: 2, unlockKey: "trianglesUnlocked" },
	{ name: "Pentagon", index: 3, unlockKey: "pentagonsUnlocked" },
	{ name: "Hexagon", index: 4, unlockKey: "hexagonsUnlocked" },
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
	{ label: () => "Shape Spawning: " + (state.shapeSpawningEnabled ? "ON" : "OFF"),
		run: () => { state.shapeSpawningEnabled = !state.shapeSpawningEnabled; } },
	{ label: "Clear All Shapes",
		run: () => { game.shapes.length = 0; } },
	{ label: "Clear All Polygons",
		run: () => { for (let i = game.shapes.length - 1; i >= 0; --i) if (!game.shapes[i].isSentry) game.shapes.splice(i, 1); } },
	{ label: "Clear Mobs",
		run: () => { for (let i = game.shapes.length - 1; i >= 0; --i) if (game.shapes[i].isSentry) game.shapes.splice(i, 1); } },
	{ label: () => {
			const real = game.sieges.find((s) => !s.neutral);
			return real ? "Sanctuary: Tier " + real.tier : "Sanctuary: OFF";
		},
		run: () => {
			const realIdx = game.sieges.findIndex((s) => !s.neutral);
			const real = realIdx >= 0 ? game.sieges[realIdx] : null;
			if (!real) {
				game.sieges.push(new Siege(1));
			} else if (real.tier === 1) {
				game.sieges.splice(realIdx, 1);
				game.sieges.push(new Siege(2));
			} else {
				game.sieges.splice(realIdx, 1);
			}
		} },
	{ label: "Max Out Tanks",
		run: () => { for (const t of game.tanks) t.maxOutLevel(); } },
	{ label: "Revive All",
		run: () => { for (const t of game.tanks) t.reviveImmediately(); } },
];

const toggleButton = new Button(() => { panelOpen = !panelOpen; }, DEBUG_COLOR);
const actionButtons = actions.map((a) => new Button(a.run, DEBUG_COLOR));
const spawnModeBtn = new Button(() => setMode("spawn"), MODE_COLOR);
const upgradeModeBtn = new Button(() => setMode("upgrade"), MODE_COLOR);
const editionModeBtn = new Button(() => setMode("edition"), MODE_COLOR);
const damageModeBtn = new Button(() => setMode("damage"), MODE_COLOR);
const resetTankModeBtn = new Button(() => setMode("resetTank"), MODE_COLOR);
const mapEditorModeBtn = new Button(() => setMode("mapEditor"), MODE_COLOR);

// Map editor grid: at the upgraded arena (fov=1, 840 wide), exactly 9 full walls (3×3)
// or 36 half walls (6×6) fit — so full = 840/3 = 280, half = 840/6 = 140.
const MAP_CELL = 140;            // half-wall side length.
const MAP_FULL = MAP_CELL * 2;   // full-wall side length (280).
const resetButton = new Button(handleReset, "#222222");
let panelOpen = false;

function handleSpawnMode() {
	for (let i = 0; i < SHAPE_KINDS.length; ++i) {
		if (keys.justPressed.has(NUMBER_CODES[i])) {
			spawnAt(i, worldFromMouse());
		}
	}
	if (keys.justPressed.has("Digit9")) {
		game.shapes.push(new Sentry(worldFromMouse()));
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

function damageEntityUnderMouse() {
	const s = screenScale();
	// Shapes
	const shape = shapeUnderMouse();
	if (shape && !shape.isDead()) {
		shape.health -= 1;
		if (shape.health <= 0) shape.startDying();
		return;
	}
	// Tanks
	for (const t of game.tanks) {
		if (t.isDead && t.isDead()) continue;
		const dx = mouse.x - t.pos.x * s;
		const dy = mouse.y - t.pos.y * s;
		if (Math.sqrt(dx * dx + dy * dy) < t.size * s) { t.takeDamage(1); return; }
	}
	// Sanctuaries
	for (const sg of game.sieges) {
		const dx = mouse.x - sg.pos.x * s;
		const dy = mouse.y - sg.pos.y * s;
		if (Math.sqrt(dx * dx + dy * dy) < sg.size * s) { sg.takeDamage(1); return; }
	}
	// Bullets in flight (tanks + sanctuaries)
	const bulletGroups = [];
	for (const t of game.tanks) bulletGroups.push(t.bullets);
	for (const sg of game.sieges) bulletGroups.push(sg.bullets);
	for (const group of bulletGroups) {
		for (const b of group) {
			if (b.dying || b.dead) continue;
			const dx = mouse.x - b.pos.x * s;
			const dy = mouse.y - b.pos.y * s;
			if (Math.sqrt(dx * dx + dy * dy) < b.size * s) { b.takeDamage(1); return; }
		}
	}
}

function handleDamageMode() {
	if (keys.justPressed.has("Escape")) { game.debugMode = null; return; }
	if (mouse.leftClick) damageEntityUnderMouse();
}

function handleMapEditorMode() {
	if (keys.justPressed.has("Escape")) { game.debugMode = null; return; }
	const w = worldFromMouse();
	// Wall snapping is anchored at the map center so a 3×3 of full walls (or 6×6 of
	// halves) lands exactly inside the upgraded map 1's playable area — and the
	// center full wall coincides with the nest tile.
	const mcx = game.room.minX + game.room.maxX / 2;
	const mcy = game.room.minY + game.room.maxY / 2;
	if (keys.justPressed.has("Digit1")) {
		const cx = mcx + Math.round((w.x - mcx) / MAP_CELL) * MAP_CELL;
		const cy = mcy + Math.round((w.y - mcy) / MAP_CELL) * MAP_CELL;
		if (!game.walls.some((wl) => wl.x === cx && wl.y === cy && wl.size === MAP_FULL)) {
			game.walls.push({ x: cx, y: cy, size: MAP_FULL });
		}
	}
	if (keys.justPressed.has("Digit2")) {
		const cx = mcx + (Math.floor((w.x - mcx) / MAP_CELL) + 0.5) * MAP_CELL;
		const cy = mcy + (Math.floor((w.y - mcy) / MAP_CELL) + 0.5) * MAP_CELL;
		if (!game.walls.some((wl) => wl.x === cx && wl.y === cy && wl.size === MAP_CELL)) {
			game.walls.push({ x: cx, y: cy, size: MAP_CELL });
		}
	}
	if (keys.pressed.has("Digit3")) {
		// Erase any wall whose bounding box contains the cursor (hold to drag-erase).
		for (let i = game.walls.length - 1; i >= 0; --i) {
			const wl = game.walls[i];
			const half = wl.size / 2;
			if (w.x >= wl.x - half && w.x <= wl.x + half && w.y >= wl.y - half && w.y <= wl.y + half) {
				game.walls.splice(i, 1);
			}
		}
	}
	if (keys.justPressed.has("Digit4")) {
		// Export the wall list as a tilemap-friendly JSON blob.
		const data = JSON.stringify({
			cellSize: MAP_CELL,
			fullSize: MAP_FULL,
			walls: game.walls.map((wl) => ({
				type: wl.size === MAP_FULL ? "full" : "half",
				x: wl.x,
				y: wl.y,
				gridX: Math.round(wl.x / MAP_CELL),
				gridY: Math.round(wl.y / MAP_CELL),
			})),
		}, null, 2);
		prompt("Copy this map JSON:", data);
	}
}

function handleResetTankMode() {
	if (keys.justPressed.has("Escape")) { game.debugMode = null; return; }
	if (!mouse.leftClick) return;
	const s = screenScale();
	// Pick any tank (alive or dead) under the cursor — tankUnderMouse skips corpses,
	// so we duplicate the radius test inline.
	for (const t of game.tanks) {
		const dx = mouse.x - t.pos.x * s;
		const dy = mouse.y - t.pos.y * s;
		if (Math.sqrt(dx * dx + dy * dy) < t.size * s) {
			t.resetUpgrades();
			return;
		}
	}
}

function applyEditionKey(sel, n) {
	if (n === 7) { if (sel.makeGold) sel.makeGold(sel.type); return; }   // 7 = Gold.
	if (n > 6) return;
	const rarity = n === 6 ? 4 : n - 2; // 1=common(-1), 2=shiny(0), 3=legendary(1), 4=shadow(2), 5=ultra(3), 6=ethereal(4)
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
	else if (game.debugMode === "damage") handleDamageMode();
	else if (game.debugMode === "resetTank") handleResetTankMode();
	else if (game.debugMode === "mapEditor") handleMapEditorMode();
}

let resetClicks = 0;
let resetClickTimer = 0;
function handleReset() {
	const now = performance.now();
	if (now - resetClickTimer > 3000) resetClicks = 0;
	resetClickTimer = now;
	resetClicks += 1;
	if (resetClicks >= 3) resetGame();
}
function resetLabel() {
	if (resetClicks === 0) return "Reset Game";
	if (resetClicks === 1) return "Reset Game (2 more)";
	return "Reset Game (1 more!)";
}

export function renderDebugPanel(ctx) {
	if (!debugVisible) return;
	const s = game.scale;
	const w = 170 * s;
	const h = 28 * s;
	const margin = 6 * s;
	const gap = 3 * s;
	const x = game.width - w - margin;
	let y = margin;
	toggleButton.render(ctx, x, y, w, h, panelOpen ? "DEBUG ▲" : "DEBUG ▼", false);
	if (panelOpen) {
		for (let i = 0; i < actions.length; ++i) {
			y += h + gap;
			const label = typeof actions[i].label === "function" ? actions[i].label() : actions[i].label;
			actionButtons[i].render(ctx, x, y, w, h, label, false);
		}
		y += h + gap;
		spawnModeBtn.render(ctx, x, y, w, h, game.debugMode === "spawn" ? "Spawn Mode ✓" : "Spawn Mode", false);
		y += h + gap;
		upgradeModeBtn.render(ctx, x, y, w, h, game.debugMode === "upgrade" ? "Upgrade Mode ✓" : "Upgrade Mode", false);
		y += h + gap;
		editionModeBtn.render(ctx, x, y, w, h, game.debugMode === "edition" ? "Edition Mode ✓" : "Edition Mode", false);
		y += h + gap;
		damageModeBtn.render(ctx, x, y, w, h, game.debugMode === "damage" ? "Damage Mode ✓" : "Damage Mode", false);
		y += h + gap;
		resetTankModeBtn.render(ctx, x, y, w, h, game.debugMode === "resetTank" ? "Reset Tank ✓" : "Reset Tank", false);
		y += h + gap;
		mapEditorModeBtn.render(ctx, x, y, w, h, game.debugMode === "mapEditor" ? "Map Editor ✓" : "Map Editor", false);
		y += h + 10 * s;
		resetButton.render(ctx, x, y, w, h, resetLabel(), false);
	}

	if (game.debugMode) {
		const banner = game.debugMode === "spawn"
			? "SPAWN MODE — press 1-5 to spawn shapes, 9 to spawn a Sentry"
			: game.debugMode === "upgrade"
			? "UPGRADE MODE — click shape, press 1-5 (tier), ESC to cancel"
			: game.debugMode === "damage"
			? "DAMAGE MODE — click any entity to deal 1 damage, ESC to cancel"
			: game.debugMode === "resetTank"
			? "RESET TANK MODE — click a tank to wipe its upgrades, ESC to cancel"
			: game.debugMode === "mapEditor"
			? "MAP EDITOR — 1=full wall, 2=half wall, 3=erase (hold), 4=export, ESC to cancel"
			: "EDITION MODE — click shape, press 1-6 (rarity, 6=Ethereal), 7=Gold, ESC to cancel";
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
