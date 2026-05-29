import { state } from "./state.js";
import { mouse, keys } from "./input.js";
import { game } from "./game.js";
import { Room } from "./room.js";
import { Button } from "./button.js";
import { Shape, TYPE_NAMES, TYPE_SIZES, TYPE_SIDES, makeShapeData } from "./shape.js";
import { drawText } from "./render.js";
import { tabs, generalTab } from "./tabs.js";
import { encode, decode, saveToStorage, loadFromStorage, enableAutoSave, onBeforeSave, applyManualSave, downloadSave, pickSaveFile } from "./save.js";
import { renderDebugPanel, updateDebug, shapeUnderMouse } from "./debug.js";
import { syncTanks, tankUnderMouse, renderTankPreview, snapshotTanks, TANK_UPGRADE_SPECS, tankUpgradeCost, tankSkillPointsSpent, tankSkillPointsCap, tankSkillPointsRemaining } from "./tank.js";
import { Siege } from "./siege.js";
import { TANK_DEFS } from "./tankDefs.js";
import { formatNumber, darken, colors } from "./utils.js";
import { switchToMap, checkMap1Unlock, ensureCrashZoneSeeded, shouldHaveNeutralSanctuary } from "./mapSwitch.js";

let upgradePanelAnim = 1;
let upgradePanelLastTank = null;
// OSA's iconColorOrder = [10, 11, 12, 15, 13, 2, 14, 4, 5, 1, 0, 3] resolved through gameDraw.getColor.
const UPGRADE_BOX_PALETTE = [
	"#3ca4cb", // 10 blue
	"#8abc3f", // 11 green
	"#e03e41", // 12 red
	"#cc669c", // 15 magenta
	"#efc74b", // 13 gold
	"#e7896d", // 2 orange (triangle)
	"#8d6adf", // 14 purple
	"#7adbba", // 4 aqua (hexagon)
	"#ef99c3", // 5 pink
	"#b9e87e", // 1 lgreen (shiny)
	"#7ad3db", // 0 teal (legendary)
	"#fdf380", // 3 yellow (neutral)
];

function getTankUpgradeBoxes(animOffset) {
	const tank = game.selectedTank;
	if (!tank) return [];
	const def = TANK_DEFS[tank.defKey];
	if (!def.upgrades || !tank.canUpgrade()) return [];
	const s = game.scale;
	const boxSize = 110 * s;
	const gap = 12 * s;
	const margin = 16 * s;
	const cols = Math.min(def.upgrades.length, 3);
	const totalW = cols * boxSize + (cols - 1) * gap;
	const slide = (animOffset ?? 0) * (totalW + margin * 2);
	const xStart = game.width - totalW - margin + slide;
	const boxes = [];
	for (let i = 0; i < def.upgrades.length; ++i) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		boxes.push({
			defKey: def.upgrades[i],
			x: xStart + col * (boxSize + gap),
			y: margin + row * (boxSize + gap),
			w: boxSize,
			h: boxSize,
			color: UPGRADE_BOX_PALETTE[i % UPGRADE_BOX_PALETTE.length],
		});
	}
	return boxes;
}

function handleTankClicks() {
	if (keys.justPressed.has("Escape") && game.controlledTank) {
		game.controlledTank = null;
	}
	const shiftHeld = keys.pressed.has("ShiftLeft") || keys.pressed.has("ShiftRight");
	if (mouse.leftClick) {
		const t = tankUnderMouse();
		if (t && shiftHeld) {
			if (t.isDead && t.isDead()) { mouse.leftClick = false; return; }
			game.controlledTank = game.controlledTank === t ? null : t;
			game.selectedTank = null;
			mouse.leftClick = false;
			return;
		}
		// Shift+click on a shape / mob marks it as the priority target. Tanks
		// will lock onto it regardless of their normal rarity / type filters.
		// Same target shift-clicked again clears it.
		if (!t && shiftHeld) {
			const sh = shapeUnderMouse();
			if (sh && !(sh.isDead && sh.isDead())) {
				game.priorityTarget = game.priorityTarget === sh ? null : sh;
				mouse.leftClick = false;
				return;
			}
		}
		if (t) mouse.leftClick = false;
	}
	if (game.controlledTank) return;
	if (handleTankUpgradeClicks()) return;
	if (!mouse.leftRelease) return;
	if (game.selectedTank) {
		const boxes = getTankUpgradeBoxes(0);
		for (const b of boxes) {
			if (mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h) {
				game.selectedTank.upgradeTo(b.defKey);
				mouse.leftRelease = false;
				return;
			}
		}
	}
	const t = tankUnderMouse();
	if (t) {
		game.selectedTank = t;
		mouse.leftRelease = false;
	} else if (game.selectedTank) {
		game.selectedTank = null;
	}
}

function renderTankUpgradePanel() {
	const tank = game.selectedTank;
	const visible = tank && TANK_DEFS[tank.defKey].upgrades && tank.canUpgrade();
	if (tank !== upgradePanelLastTank) {
		upgradePanelAnim = 1;
		upgradePanelLastTank = tank;
	}
	if (!visible) return;
	upgradePanelAnim *= 0.78;
	if (upgradePanelAnim < 0.005) upgradePanelAnim = 0;
	const boxes = getTankUpgradeBoxes(upgradePanelAnim);
	if (boxes.length === 0) return;
	const ctx = game.ctx;
	const s = game.scale;
	const spin = (Date.now() * 0.001) % (Math.PI * 2);
	for (const b of boxes) {
		const hovered = upgradePanelAnim < 0.05 && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
		// Box fill at OSA's 0.6 alpha
		ctx.globalAlpha = 0.6;
		ctx.fillStyle = b.color;
		ctx.fillRect(b.x, b.y, b.w, b.h);
		// Hover overlay
		if (hovered) {
			ctx.globalAlpha = mouse.left ? 0.2 : 0.15;
			ctx.fillStyle = mouse.left ? "#000000" : "#ffffff";
			ctx.fillRect(b.x, b.y, b.w, b.h);
		}
		// Bottom 40% darker gradient (OSA's pseudo-3D shading)
		ctx.globalAlpha = 0.25;
		ctx.fillStyle = "#000000";
		ctx.fillRect(b.x, b.y + b.h * 0.6, b.w, b.h * 0.4);
		ctx.globalAlpha = 1;

		const previewSize = b.w * 0.22;
		const previewX = b.x + b.w / 2;
		const previewY = b.y + b.h / 2 - 6 * s;
		const fakeTank = { defKey: b.defKey, gunStates: TANK_DEFS[b.defKey].guns.map(() => null) };
		renderTankPreview(ctx, fakeTank, previewX, previewY, previewSize, spin);
		drawText(ctx, TANK_DEFS[b.defKey].label, b.x + b.w / 2, b.y + b.h - 12 * s, false, true, true, 14 * s);

		// Border last so it sits on top of everything
		ctx.strokeStyle = "#484848";
		ctx.lineWidth = 2 * s;
		ctx.strokeRect(b.x, b.y, b.w, b.h);
	}
}

function getTankUpgradeBars(tank) {
	if (!tank) return [];
	const s = game.scale;
	const lineH = 28 * s;
	const subH = 24 * s;
	const barH = 22 * s;
	const barGap = 6 * s;
	const barW = 220 * s;
	const x = 12 * s;
	const totalUpg = TANK_UPGRADE_SPECS.length * (barH + barGap) - barGap;
	const totalH = lineH + subH + 8 * s + totalUpg;
	const yTop = game.height - 12 * s - totalH;
	const bars = [];
	let by = yTop + lineH + subH + 8 * s;
	for (const spec of TANK_UPGRADE_SPECS) {
		bars.push({ spec, x, y: by, w: barW, h: barH });
		by += barH + barGap;
	}
	return { bars, yTop, lineH, subH, x };
}

// OSA-style rounded stat bar: thick black outer line, thinner gray inner, then a
// colored fill at level/max width — all stroked with lineCap="round" so the ends
// are perfectly hemispherical. Vertical dividers separate filled segments.
function drawStatBar(ctx, x, y, w, h, level, max, color) {
	const s = game.scale;
	const cy = y + h / 2;
	const r = h / 2;
	const x1 = x + r;
	const x2 = x + w - r;
	const span = x2 - x1;
	const fillX = x1 + span * Math.max(0, Math.min(1, level / max));
	const prevCap = ctx.lineCap;
	ctx.lineCap = "round";
	// Black outer ring
	ctx.strokeStyle = "#000000";
	ctx.lineWidth = h;
	ctx.beginPath();
	ctx.moveTo(x1, cy);
	ctx.lineTo(x2, cy);
	ctx.stroke();
	// Gray interior
	ctx.strokeStyle = "#5a5a5a";
	ctx.lineWidth = h - 3 * s;
	ctx.beginPath();
	ctx.moveTo(x1, cy);
	ctx.lineTo(x2, cy);
	ctx.stroke();
	// Colored fill — slightly inset from the gray so a thin gray border shows around it (OSA layered look).
	if (level > 0) {
		ctx.strokeStyle = color;
		ctx.lineWidth = h - 5 * s;
		ctx.beginPath();
		ctx.moveTo(x1, cy);
		ctx.lineTo(fillX, cy);
		ctx.stroke();
	}
	// Black dividers between filled segments (only inside the gray track).
	ctx.lineCap = "butt";
	ctx.strokeStyle = "#000000";
	ctx.lineWidth = Math.max(1, 1.5 * s);
	for (let i = 1; i < max; i++) {
		const dx = x1 + span * (i / max);
		ctx.beginPath();
		ctx.moveTo(dx, y + 2 * s);
		ctx.lineTo(dx, y + h - 2 * s);
		ctx.stroke();
	}
	ctx.lineCap = prevCap;
}

function bulkBuyQuantity() {
	if (keys.pressed.has("AltLeft") || keys.pressed.has("AltRight")) return 100;
	if (keys.pressed.has("ShiftLeft") || keys.pressed.has("ShiftRight")) return 10;
	return 1;
}

// Returns { count, total } where count is the number actually affordable up to the
// max level and the desired bulk amount, and total is the score required.
function planBulkUpgrade(tank, spec, desired) {
	let level = tank.upgrades[spec.key];
	let total = 0;
	let count = 0;
	let scoreLeft = state.score;
	const pointsLeft = tankSkillPointsRemaining(tank);
	const cap = Math.min(desired, pointsLeft);
	while (count < cap && level < spec.max) {
		const cost = tankUpgradeCost(spec, level);
		if (scoreLeft < cost) break;
		scoreLeft -= cost;
		total += cost;
		level += 1;
		count += 1;
	}
	return { count, total };
}

function renderTankInfoPanel(tank) {
	const ctx = game.ctx;
	const s = game.scale;
	const layout = getTankUpgradeBars(tank);
	const { yTop, lineH, subH, x, bars } = layout;
	const isDead = tank.isDead && tank.isDead();
	const hp = Math.max(0, Math.floor(tank.health));
	const maxHp = Math.round(tank.maxHealth);
	const shieldFull = (tank.maxShield ?? 0) > 0 && (tank.shield ?? 0) >= tank.maxShield;
	const hpRegenLabel = isDead ? ", DEAD" : (shieldFull ? ", +25 HP/s" : ", heals when shielded");
	const hpLabel = " - " + hp + "/" + maxHp + " HP" + hpRegenLabel;
	drawText(ctx, tank.classification + hpLabel, x, yTop, false, true, false, 28 * s);
	const sh = Math.max(0, Math.floor(tank.shield ?? 0));
	const maxSh = Math.round(tank.maxShield ?? 0);
	const shieldLabel = "Shield " + sh + "/" + maxSh;
	const levelLabel = "Lvl " + tank.level + " (" + formatNumber(tank.xpProgress()) + "/" + formatNumber(tank.xpNeeded()) + ")";
	const pointsRemaining = tankSkillPointsRemaining(tank);
	const pointsCap = tankSkillPointsCap(tank);
	const pointsLabel = "Points " + (pointsCap - pointsRemaining) + "/" + pointsCap;
	drawText(ctx, levelLabel + "  |  " + shieldLabel + "  |  " + pointsLabel, x, yTop + lineH, false, true, false, 24 * s);
	const desired = bulkBuyQuantity();
	const noPoints = pointsRemaining <= 0;
	for (const b of bars) {
		const level = tank.upgrades?.[b.spec.key] ?? 0;
		const maxed = level >= b.spec.max;
		const plan = maxed ? { count: 0, total: 0 } : planBulkUpgrade(tank, b.spec, desired);
		const canAfford = plan.count > 0;
		const hovered = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
		drawStatBar(ctx, b.x, b.y, b.w, b.h, level, b.spec.max, b.spec.color);
		if (hovered && !maxed && !noPoints) {
			ctx.fillStyle = mouse.left && canAfford ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.18)";
			ctx.fillRect(b.x, b.y, b.w, b.h);
		}
		drawText(ctx, b.spec.label + " " + level + "/" + b.spec.max, b.x + 8 * s, b.y + b.h / 2 - 8 * s, false, true, false, 16 * s);
		let costText;
		if (maxed) costText = "MAX";
		else if (noPoints) costText = "No points";
		else if (desired > 1 && plan.count >= 1) costText = formatNumber(plan.total) + " (x" + plan.count + ")";
		else if (canAfford) costText = formatNumber(plan.total);
		else costText = formatNumber(tankUpgradeCost(b.spec, level)) + " (need score)";
		drawText(ctx, costText, b.x + b.w + 10 * s, b.y + b.h / 2 - 8 * s, !canAfford && !maxed, true, false, 16 * s);
	}
}

function handleTankUpgradeClicks() {
	const tank = game.selectedTank;
	if (!tank) return false;
	if (!mouse.leftRelease) return false;
	const { bars } = getTankUpgradeBars(tank);
	const desired = bulkBuyQuantity();
	for (const b of bars) {
		if (mouse.x < b.x || mouse.x > b.x + b.w) continue;
		if (mouse.y < b.y || mouse.y > b.y + b.h) continue;
		const level = tank.upgrades[b.spec.key];
		if (level >= b.spec.max) return true;
		const plan = planBulkUpgrade(tank, b.spec, desired);
		if (plan.count <= 0) return true;
		state.score -= plan.total;
		tank.upgrades[b.spec.key] = level + plan.count;
		mouse.leftRelease = false;
		return true;
	}
	return false;
}

game.init({ Room, tabs, generalTab });

loadFromStorage();
// Migration: poison was a single-purchase flag (poisonOwned). It's now a level
// (1..4). Old saves get bumped to level 1 so they don't silently lose their
// purchase.
if (state.poisonOwned && !state.poisonLevel) state.poisonLevel = 1;
// Same migration for Lightning — it used to be a single-purchase flag and is
// now a 4-level upgrade. Old saves get bumped to level 1.
if (state.lightningOwned && !state.lightningLevel) state.lightningLevel = 1;
syncTanks();
ensureCrashZoneSeeded();   // seed walls + neutral sentry if loading directly into Map 1.
// Sanctuary no longer auto-spawns; toggle it via the debug panel.
onBeforeSave(snapshotTanks);
enableAutoSave();

game.resize();
window.addEventListener("resize", () => game.resize());
document.body.appendChild(game.canvas);

const saveButton = new Button(() => { downloadSave(); }, "#3085db");
const loadButton = new Button(async () => {
	// File picker only — no paste prompt. If the user cancels we just exit.
	const data = await pickSaveFile();
	if (!data) return;
	try {
		// applyManualSave writes the raw string into localStorage under the
		// autosave key and reloads — the next boot reads it through the normal
		// loadFromStorage path so live game state rebuilds cleanly.
		applyManualSave(data);
	} catch (e) {
		console.error("Load failed:", e);
		alert("Couldn't load that save — " + (e && e.message ? e.message : "data couldn't be parsed") + "\n\nTip: re-copy the full string and try again.");
	}
}, "#db9146");
const shapeAnimButton = new Button(() => { state.shapeDeathAnimEnabled = !state.shapeDeathAnimEnabled; }, "#efc74b");
const bulletAnimButton = new Button(() => { state.bulletDeathAnimEnabled = !state.bulletDeathAnimEnabled; }, "#58b0d0");
const damageBlendButton = new Button(() => { state.damageBlendEnabled = !state.damageBlendEnabled; }, "#e03e41");

let nextSpawnTime = 0;
let lastFrameTime = 0;

// requestAnimationFrame pauses while the tab is hidden but performance.now()
// keeps advancing. On resume the timers (shape spawn, sanctuary shoot, healer
// turret, spawner) would otherwise "catch up" and spew accumulated activity
// in a single frame. Detect long gaps and reset every time-based scheduler.
function resyncTimersAfterPause(now) {
	nextSpawnTime = now;
	for (const sg of game.sieges) {
		sg.shootTime = now;
		if (sg.healerTurret) sg.healerTurret.shootTime = now;
	}
	for (const sh of game.shapes) {
		if (typeof sh.shootTime === "number") sh.shootTime = now;
		if (typeof sh.spawnTime === "number") sh.spawnTime = now;
		if (sh.healerTurret && typeof sh.healerTurret.shootTime === "number") sh.healerTurret.shootTime = now;
	}
}

// Two-tone button styling (matches Button.render): a solid top fill with a
// darker bottom 40%, plus a thick #222 border. Used by the Map tab and by each
// area hexagon in the map overlay.
function drawTwoToneRect(ctx, x, y, w, h, fill, hovered, pressed, scale) {
	ctx.lineWidth = 12 * scale;
	ctx.strokeStyle = "#222";
	ctx.strokeRect(x, y, w, h);
	const top = pressed ? darken(fill, 0.75) : fill;
	const bot = pressed ? fill : darken(fill, 0.75);
	ctx.fillStyle = top;
	ctx.fillRect(x, y, w, h);
	ctx.fillStyle = bot;
	ctx.fillRect(x, y + h * 0.6, w, h * 0.4);
	if (hovered) {
		ctx.fillStyle = "rgba(255,255,255,0.1)";
		ctx.fillRect(x, y, w, h);
	}
}

// Areas shown in the overlay. Each is placed inside the continent at the given
// axial-hex coordinate (q, r). The first slot maps to state.currentMap === 0.
const MAP_AREAS = [
	{ key: 0, label: "Origin",     color: colors.shiny, q: 0, r: 0 },   // center.
	{ key: 1, label: "Crash Zone", color: "#ef99c3",    q: 1, r: 0  },  // direct right neighbor of Origin.
];

// Deterministic continent shape so the layout is stable across reopens / reloads.
// We build a roughly circular blob with frayed edges by walking a hex grid out
// to distance 6 and accepting outer cells with decreasing probability.
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6D2B79F5) | 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
// Each island is a separate hex blob: tiles inside `baseRadius` always included,
// a probabilistic frayed ring just outside. Spacing between island centers is
// wide enough that the rings don't bridge into each other.
const ISLANDS = [
	{ center: { q:  0, r:  0 }, baseRadius: 3, fringeProb: 0.7 },   // Origin / Crash Zone island.
	{ center: { q: -9, r:  4 }, baseRadius: 2, fringeProb: 0.6 },   // west.
	{ center: { q:  8, r: -6 }, baseRadius: 2, fringeProb: 0.5 },   // northeast.
	{ center: { q:  4, r:  7 }, baseRadius: 2, fringeProb: 0.6 },   // south.
	{ center: { q: -6, r: -5 }, baseRadius: 1, fringeProb: 0.5 },   // small northwest islet.
];
const CONTINENT = (() => {
	const rand = mulberry32(0xC0FFEE);
	const tiles = new Map();
	for (const island of ISLANDS) {
		const { q: cq, r: cr } = island.center;
		const span = island.baseRadius + 1;
		for (let q = cq - span; q <= cq + span; q++) {
			for (let r = cr - span; r <= cr + span; r++) {
				const dq = q - cq;
				const dr = r - cr;
				const dist = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
				if (dist <= island.baseRadius) {
					tiles.set(q + "," + r, { q, r });
				} else if (dist === island.baseRadius + 1 && rand() < island.fringeProb) {
					tiles.set(q + "," + r, { q, r });
				}
			}
		}
	}
	// Ensure every real area's tile is included even if its slot was rolled out.
	for (const a of MAP_AREAS) {
		const k = a.q + "," + a.r;
		if (!tiles.has(k)) tiles.set(k, { q: a.q, r: a.r });
	}
	return [...tiles.values()];
})();

function hexPath(ctx, cx, cy, r) {
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const a = -Math.PI / 2 + i * (Math.PI / 3);   // pointy-top.
		const x = cx + Math.cos(a) * r;
		const y = cy + Math.sin(a) * r;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

// Pointy-top hexagon inside-test. Circumradius r, apothem (max half-width) = r√3/2.
// A point is inside iff it's within the bounding box AND below the diagonal edge
// (|dy| + |dx|/√3 ≤ r derived from edge vertices (0, -r) and (apothem, -r/2)).
function pointInHex(px, py, cx, cy, r) {
	const dx = Math.abs(px - cx);
	const dy = Math.abs(py - cy);
	const apothem = r * Math.sqrt(3) / 2;
	if (dx > apothem) return false;
	if (dy > r) return false;
	return dy + dx / Math.sqrt(3) <= r;
}

// Map tab — full-width button sitting above the upgrade tabs. Same height (50)
// as the per-category tab buttons; wider so it spans from the left edge to the
// right edge of the upgrade panel. Visible once Map 1 is unlocked.
// Render the Settings panel's stats list. Two columns of category groups so it
// fits below the toggle buttons. Each group: heading + key/value lines.
function renderSettingsStats(ctx, s, yStart) {
	const unlockedAreas = 1 + (state.map1Unlocked ? 1 : 0);
	const shapeRoll = Math.floor(state.shapeTypeBuff || 1);
	const fmt = (n) => formatNumber(typeof n === "number" ? n : 0);
	const groups = [
		{ title: "Clicking", rows: [
			["Shape clicks",          fmt(state.statShapeClicks)],
			["Misses",                fmt(state.statClickMisses)],
			["Damage by clicking",    fmt(state.statClickDamageDealt)],
		] },
		{ title: "Kills", rows: [
			["Total shape kills",     fmt(state.statShapeKillsTotal)],
			["Click contributed",     fmt(state.statShapeKillsClick)],
			["Tank contributed",      fmt(state.statShapeKillsTank)],
			["Rare shapes killed",    fmt(state.statRareKills)],
			["Gold shapes killed",    fmt(state.statGoldKills)],
		] },
		{ title: "Progress", rows: [
			["Unlocked areas",        unlockedAreas + " / 2"],
			["Upgrades bought",       fmt(state.statUpgradesBought)],
			["Shape roll chance",     fmt(shapeRoll)],
			["Tank deaths",           fmt(state.statTankDeaths)],
		] },
	];
	const colW = 320 * s;
	const colGap = 30 * s;
	const totalW = colW * 3 + colGap * 2;
	let x0 = Math.max(40 * s, (game.width - totalW) / 2);
	for (const g of groups) {
		let y = yStart;
		drawText(ctx, "— " + g.title + " —", x0 + colW / 2, y, false, true, true, 22 * s);
		y += 34 * s;
		for (const [label, value] of g.rows) {
			drawText(ctx, label + ": " + value, x0, y, false, true, false, 18 * s);
			y += 26 * s;
		}
		x0 += colW + colGap;
	}
}

// =============================================================================
// Achievements
// =============================================================================
// Each entry: id, title, description, icon (shape spec or { kind: "cursor" }),
// and crate color (string key OR { split: [a, b] } for the diagonal-split crates).
function highestScoreAcrossMaps() {
	const cur = state.score || 0;
	const other = state.maps && state.maps[state.currentMap === 0 ? 1 : 0]?.score || 0;
	return Math.max(cur, other);
}
const ACHIEVEMENTS = [
	// Score milestones.
	{ id: "score_egg",      title: "Egg",      desc: "Reach 1,000 score.",                  icon: { type: 0 }, crate: "blue", check: () => highestScoreAcrossMaps() >= 1e3 },
	{ id: "score_square",   title: "Square",   desc: "Reach 1,000,000 score.",              icon: { type: 1 }, crate: "blue", check: () => highestScoreAcrossMaps() >= 1e6 },
	{ id: "score_triangle", title: "Triangle", desc: "Reach 1,000,000,000,000 score.",      icon: { type: 2 }, crate: "blue", check: () => highestScoreAcrossMaps() >= 1e12 },
	{ id: "score_pentagon", title: "Pentagon", desc: "Reach 1e15 score.",                   icon: { type: 3 }, crate: "blue", check: () => highestScoreAcrossMaps() >= 1e15 },
	{ id: "score_hexagon",  title: "Hexagon",  desc: "Reach 1e18 score.",                   icon: { type: 4 }, crate: "blue", check: () => highestScoreAcrossMaps() >= 1e18 },
	// Click counts.
	{ id: "click_1", title: "Click I",   desc: "Click a shape 1,000 times.",   icon: { kind: "cursor" }, crate: "click_blue",                check: () => (state.statShapeClicks || 0) >= 1000 },
	{ id: "click_2", title: "Click II",  desc: "Click a shape 10,000 times.",  icon: { kind: "cursor" }, crate: { split: ["click_blue", "shiny"] },     check: () => (state.statShapeClicks || 0) >= 10000 },
	{ id: "click_3", title: "Click III", desc: "Click a shape 100,000 times.", icon: { kind: "cursor" }, crate: { split: ["click_blue", "legendary"] }, check: () => (state.statShapeClicks || 0) >= 100000 },
	// Rarity hunters.
	{ id: "shiny_1", title: "Shiny Hunter I",   desc: "Kill 1,000 Shiny shapes.",   icon: { type: 0, rarity: 0 }, crate: "shiny", check: () => (state.statShinyKills || 0) >= 1000 },
	{ id: "shiny_2", title: "Shiny Hunter II",  desc: "Kill 5,000 Shiny shapes.",   icon: { type: 1, rarity: 0 }, crate: "shiny", check: () => (state.statShinyKills || 0) >= 5000 },
	{ id: "shiny_3", title: "Shiny Hunter III", desc: "Kill 25,000 Shiny shapes.",  icon: { type: 2, rarity: 0 }, crate: "shiny", check: () => (state.statShinyKills || 0) >= 25000 },
	{ id: "legend_1", title: "Legendary Hunter I",   desc: "Kill 1,000 Legendary shapes.",   icon: { type: 0, rarity: 1 }, crate: "legendary", check: () => (state.statLegendaryKills || 0) >= 1000 },
	{ id: "legend_2", title: "Legendary Hunter II",  desc: "Kill 5,000 Legendary shapes.",   icon: { type: 1, rarity: 1 }, crate: "legendary", check: () => (state.statLegendaryKills || 0) >= 5000 },
	{ id: "legend_3", title: "Legendary Hunter III", desc: "Kill 25,000 Legendary shapes.",  icon: { type: 2, rarity: 1 }, crate: "legendary", check: () => (state.statLegendaryKills || 0) >= 25000 },
	{ id: "shadow_1", title: "Shadow Hunter I",   desc: "Kill 1,000 Shadow shapes.",   icon: { type: 0, rarity: 2 }, crate: "shadow", check: () => (state.statShadowKills || 0) >= 1000 },
	{ id: "shadow_2", title: "Shadow Hunter II",  desc: "Kill 5,000 Shadow shapes.",   icon: { type: 1, rarity: 2 }, crate: "shadow", check: () => (state.statShadowKills || 0) >= 5000 },
	{ id: "shadow_3", title: "Shadow Hunter III", desc: "Kill 25,000 Shadow shapes.",  icon: { type: 2, rarity: 2 }, crate: "shadow", check: () => (state.statShadowKills || 0) >= 25000 },
	{ id: "rainbow_1", title: "Rainbow Hunter I",   desc: "Kill 1,000 Rainbow shapes.",   icon: { type: 0, rarity: 3 }, crate: "rainbow", check: () => (state.statRainbowKills || 0) >= 1000 },
	{ id: "rainbow_2", title: "Rainbow Hunter II",  desc: "Kill 5,000 Rainbow shapes.",   icon: { type: 1, rarity: 3 }, crate: "rainbow", check: () => (state.statRainbowKills || 0) >= 5000 },
	{ id: "rainbow_3", title: "Rainbow Hunter III", desc: "Kill 25,000 Rainbow shapes.",  icon: { type: 2, rarity: 3 }, crate: "rainbow", check: () => (state.statRainbowKills || 0) >= 25000 },
	// Gold.
	{ id: "gold_1", title: "Gold Hunter I",  desc: "Kill 3 Gold shapes.",   icon: { type: 0, gold: true }, crate: "gold", check: () => (state.statGoldKills || 0) >= 3 },
	{ id: "gold_2", title: "Gold Miner II",  desc: "Kill 10 Gold shapes.",  icon: { type: 1, gold: true }, crate: "gold", check: () => (state.statGoldKills || 0) >= 10 },
	{ id: "gold_3", title: "Gold Expert III", desc: "Kill 30 Gold shapes.", icon: { type: 2, gold: true }, crate: "gold", check: () => (state.statGoldKills || 0) >= 30 },
];

function crateColorOf(name) {
	switch (name) {
		case "blue":       return "#3ca4cb";
		case "click_blue": return "#3085db";
		case "shiny":      return colors.shiny;
		case "legendary":  return colors.legendary;
		case "shadow":     return "#3a3a3a";
		case "rainbow":    { const h = (Date.now() * 0.1) % 360; return `hsl(${h}, 80%, 60%)`; }
		case "gold":       return "#efc74b";
		case "red":        return "#cc3a3a";
		default:           return "#888";
	}
}

let achievementsSilentInit = false;
function checkAchievements() {
	if (!state.achievementsUnlocked) state.achievementsUnlocked = {};
	for (const ach of ACHIEVEMENTS) {
		if (state.achievementsUnlocked[ach.id]) continue;
		if (ach.check()) {
			state.achievementsUnlocked[ach.id] = true;
			if (achievementsSilentInit) game.achievementToasts.push({ achId: ach.id, expiry: performance.now() + 4500 });
		}
	}
	achievementsSilentInit = true;
}

function drawAchievementIcon(ctx, cx, cy, size, icon, unlocked) {
	if (!unlocked) {
		ctx.font = "bold " + (size * 0.7) + "px Ubuntu";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.lineWidth = size / 8;
		ctx.strokeStyle = "#222";
		ctx.strokeText("?", cx, cy);
		ctx.fillStyle = "#fff";
		ctx.fillText("?", cx, cy);
		return;
	}
	if (icon.kind === "cursor") {
		ctx.fillStyle = "rgba(60,60,60,0.45)";
		ctx.strokeStyle = "#222";
		ctx.lineWidth = 3 * game.scale * game.room.fov;
		ctx.beginPath();
		ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		return;
	}
	// Shape icon. Gold gets the gold body color + a hint of aura behind it.
	const rarity = icon.rarity ?? -1;
	const tier = icon.tier ?? 1;
	if (icon.gold) {
		ctx.fillStyle = "rgba(254,202,63,0.35)";
		ctx.beginPath();
		ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
		ctx.fill();
		// Render the shape in gold (square color) regardless of base type.
		drawGalleryShapeColored(ctx, cx, cy, size * 0.35, icon.type, tier, "#efc74b");
		return;
	}
	drawGalleryShape(ctx, cx, cy, size * 0.35, icon.type, tier, rarity);
}

// Like drawGalleryShape but uses a forced color (for gold-icon override).
function drawGalleryShapeColored(ctx, cx, cy, maxR, type, tier, color) {
	const r = previewRadius(maxR, type, tier);
	const data = makeShapeData(type, -1, tier);
	const sides = data.sides;
	ctx.fillStyle = color;
	ctx.strokeStyle = darken(color);
	ctx.lineWidth = 3 * game.scale * game.room.fov;
	ctx.lineJoin = "round";
	const baseSides = Math.max(3, sides);
	const cosFactor = Math.cos(Math.PI / baseSides);
	for (let i = 0; i < Math.max(1, tier); i++) {
		const layerR = r * Math.pow(cosFactor, i);
		const rot = (i & 1) ? 0 : Math.PI / baseSides;
		ctx.beginPath();
		if (sides === 0) {
			ctx.arc(cx, cy, layerR, 0, Math.PI * 2);
		} else {
			for (let j = 0; j < sides; j++) {
				const a = rot + (j / sides) * Math.PI * 2;
				const px = cx + Math.cos(a) * layerR;
				const py = cy + Math.sin(a) * layerR;
				if (j === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
		}
		ctx.fill();
		ctx.stroke();
	}
}

// Button-style background for a crate or toast. `crate` is either a color key
// string or { split: [a, b] } for the diagonal-split crates. Same two-tone
// styling Buttons use elsewhere — top fill, 40 %-darker bottom band capped at
// 32*s, hover highlight, dark border.
function drawCrateBackground(ctx, x, y, w, h, crate, hovered) {
	if (typeof crate === "object" && crate.split) {
		const c1 = crateColorOf(crate.split[0]);
		const c2 = crateColorOf(crate.split[1]);
		ctx.fillStyle = c1;
		ctx.fillRect(x, y, w, h);
		ctx.fillStyle = c2;
		ctx.beginPath();
		ctx.moveTo(x + w, y);
		ctx.lineTo(x, y + h);
		ctx.lineTo(x + w, y + h);
		ctx.closePath();
		ctx.fill();
	} else {
		const fill = crateColorOf(crate);
		ctx.fillStyle = fill;
		ctx.fillRect(x, y, w, h);
		ctx.fillStyle = darken(fill, 0.75);
		const darkH = Math.min(h * 0.4, 32 * game.scale);
		ctx.fillRect(x, y + h - darkH, w, darkH);
	}
	if (hovered) {
		ctx.fillStyle = "rgba(255,255,255,0.12)";
		ctx.fillRect(x, y, w, h);
	}
	ctx.lineWidth = 8 * game.scale;
	ctx.strokeStyle = "#222";
	ctx.strokeRect(x, y, w, h);
}

function drawAchievementCrate(ctx, x, y, size, ach, unlocked, hovered) {
	drawCrateBackground(ctx, x, y, size, size, unlocked ? ach.crate : "red", hovered);
	drawAchievementIcon(ctx, x + size / 2, y + size / 2, size, ach.icon, unlocked);
}

function drawAchievementTooltip(ctx, anchorX, anchorY, anchorW, ach, unlocked, progress = 1) {
	const s = game.scale;
	const w = 320 * s;
	const h = 90 * s;
	let x = anchorX + anchorW / 2 - w / 2;
	x = Math.max(8 * s, Math.min(game.width - w - 8 * s, x));
	// Tooltip slides UP out from behind the crate to a resting spot above it.
	// If there's no room above, flip below as a fallback.
	const flipBelow = anchorY - h - 10 * s < 10 * s;
	const finalY = flipBelow ? anchorY + anchorW + 10 * s : anchorY - h - 10 * s;
	// Ease-out cubic: quick start, gentle settle.
	const eased = 1 - Math.pow(1 - progress, 3);
	// Start fully tucked behind the crate (tooltip's far edge aligned to crate
	// edge), end at the resting spot.
	const startY = flipBelow ? anchorY + anchorW - h : anchorY;
	const y = startY + (finalY - startY) * eased;
	const title = unlocked ? ach.title : "Unknown";
	const desc = unlocked ? ach.desc : "You have not unlocked this yet!";
	ctx.save();
	// Clip to the region OUTSIDE the crate, so any part of the tooltip still
	// overlapping the crate stays hidden — the tooltip emerges cleanly from
	// behind it instead of poking out the sides.
	ctx.beginPath();
	if (flipBelow) {
		ctx.rect(0, anchorY + anchorW, game.width, game.height);
	} else {
		ctx.rect(0, 0, game.width, anchorY);
	}
	ctx.clip();
	ctx.globalAlpha = eased;
	drawCrateBackground(ctx, x, y, w, h, unlocked ? "blue" : "red", false);
	drawText(ctx, title, x + w / 2, y + 24 * s, false, true, true, 24 * s);
	drawText(ctx, desc, x + w / 2, y + 58 * s, false, true, true, 16 * s);
	ctx.restore();
}

function renderAchievements() {
	const ctx = game.ctx;
	const s = game.scale;
	if (!state.achievementsUnlocked) state.achievementsUnlocked = {};
	const cols = 6;
	const crate = 72 * s;
	const gap = 12 * s;
	const totalW = cols * crate + (cols - 1) * gap;
	const xStart = (game.width - totalW) / 2;
	const yStart = 180 * s;
	// Compute hover + crate positions first, then render in three passes so the
	// tooltip can sit visually BELOW the hovered crate (layered, not just
	// positioned). Pass 1: every crate. Pass 2: tooltip (covers neighbour
	// crates, but the hovered crate gets redrawn in Pass 3 on top of it, so
	// the tooltip appears to emerge from under the crate as it slides down).
	const slots = [];
	let hovered = null;
	for (let i = 0; i < ACHIEVEMENTS.length; i++) {
		const ach = ACHIEVEMENTS[i];
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = xStart + col * (crate + gap);
		const y = yStart + row * (crate + gap);
		const unlocked = !!state.achievementsUnlocked[ach.id];
		const isHover = mouse.x >= x && mouse.x <= x + crate && mouse.y >= y && mouse.y <= y + crate;
		const slot = { ach, x, y, unlocked, isHover };
		slots.push(slot);
		if (isHover) hovered = slot;
	}
	// Pass 1: all crates.
	for (const slot of slots) {
		drawAchievementCrate(ctx, slot.x, slot.y, crate, slot.ach, slot.unlocked, slot.isHover);
	}
	// Pass 2: tooltip behind the hovered crate.
	if (hovered) {
		const now = performance.now();
		if (!game._achTooltipHover || game._achTooltipHover.achId !== hovered.ach.id) {
			game._achTooltipHover = { achId: hovered.ach.id, startTime: now };
		}
		const elapsed = now - game._achTooltipHover.startTime;
		const progress = Math.max(0, Math.min(1, elapsed / 500));
		drawAchievementTooltip(ctx, hovered.x, hovered.y, crate, hovered.ach, hovered.unlocked, progress);
		// Pass 3: redraw the hovered crate on top so the tooltip appears layered
		// underneath it.
		drawAchievementCrate(ctx, hovered.x, hovered.y, crate, hovered.ach, hovered.unlocked, true);
	} else {
		game._achTooltipHover = null;
	}
	// Summary at bottom: "N / Total unlocked"
	const total = ACHIEVEMENTS.length;
	const unlocked = ACHIEVEMENTS.reduce((n, a) => n + (state.achievementsUnlocked[a.id] ? 1 : 0), 0);
	drawText(ctx, unlocked + " / " + total + " unlocked",
		game.width / 2, game.height - 40 * s, false, true, true, 24 * s);
}

// Binary-search the longest prefix of `text` whose width (plus "...") fits in
// `maxW` at `fontPx` Ubuntu — i.e. the canvas font drawText also uses. Returns
// the unchanged text if it already fits.
function truncateToWidth(ctx, text, fontPx, maxW) {
	const prev = ctx.font;
	ctx.font = fontPx + "px Ubuntu";
	if (ctx.measureText(text).width <= maxW) { ctx.font = prev; return text; }
	let lo = 0, hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(text.slice(0, mid) + "...").width <= maxW) lo = mid;
		else hi = mid - 1;
	}
	ctx.font = prev;
	return text.slice(0, lo).trimEnd() + "...";
}

function renderAchievementToasts() {
	const ctx = game.ctx;
	const s = game.scale;
	const now = performance.now();
	for (let i = game.achievementToasts.length - 1; i >= 0; --i) {
		if (now > game.achievementToasts[i].expiry) game.achievementToasts.splice(i, 1);
	}
	if (!game.achievementToasts.length) return;
	// Match the upgrade-button "tall" slot: title at y+8 (32px), description at
	// y+38 (24px), total height 106 * s. The toast uses the same metrics so it
	// reads as the same kind of button. A small icon box on the left, separated
	// by a divider, carries the achievement-coloured background and icon.
	const h = 106 * s;
	const w = 360 * s;
	const iconBoxW = 90 * s;
	const right = game.width - 16 * s;
	let y = 16 * s;
	for (const t of game.achievementToasts) {
		const ach = ACHIEVEMENTS.find((a) => a.id === t.achId);
		if (!ach) continue;
		const remaining = t.expiry - now;
		const total = 4500;
		const elapsed = total - remaining;
		const slideT = Math.min(1, elapsed / 450);
		const slideEased = 1 - Math.pow(1 - slideT, 3);
		const fadeIn = Math.min(1, elapsed / 700);
		const fadeOut = remaining < 600 ? remaining / 600 : 1;
		ctx.globalAlpha = Math.min(fadeIn, fadeOut);
		const x = right - w + (1 - slideEased) * (w + 16 * s);
		const inBounds = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
		const hovered = inBounds && !game.openMenu;
		// Main panel (neutral blue) — body of the upgrade-style button.
		drawCrateBackground(ctx, x, y, w, h, "blue", hovered);
		// Left icon mini-box, achievement-coloured.
		drawCrateBackground(ctx, x, y, iconBoxW, h, ach.crate, hovered);
		drawAchievementIcon(ctx, x + iconBoxW / 2, y + h / 2, iconBoxW * 0.78, ach.icon, true);
		// Divider line between mini-box and text column.
		ctx.fillStyle = "#222";
		ctx.fillRect(x + iconBoxW - 2 * s, y, 4 * s, h);
		// Text: title (achievement name) at the upgrade-slot title slot, then the
		// achievement description on the smaller description line.
		const textX = x + iconBoxW + 10 * s;
		const titleMaxW = x + w - 8 * s - textX;
		const descMaxW = titleMaxW;
		drawText(ctx, truncateToWidth(ctx, ach.title, 32 * s, titleMaxW), textX, y + 8 * s, false, true, false, 32 * s);
		drawText(ctx, truncateToWidth(ctx, ach.desc, 24 * s, descMaxW), textX, y + 50 * s, false, true, false, 24 * s);
		if (hovered && mouse.leftRelease) {
			game.openMenu = "achievements";
			mouse.leftRelease = false;
		}
		y += h + 14 * s;
	}
	ctx.globalAlpha = 1;
}

// Hover-info fill color keyed by rarity. Rainbow cycles hue with the same
// formula as rainbow shapes; Shadow is semi-transparent black; the rest match
// their canonical palette entries. Border stroke is unchanged (drawText uses
// "#222" regardless).
function rarityTextFill(rarity, isGold, isGem) {
	if (isGold) return "#efc74b";   // gold-shape body color.
	switch (rarity) {
		case 0: return colors.shiny;
		case 1: return colors.legendary;
		case 2: return isGem ? undefined : "rgba(20,20,20,0.55)";   // shadow gem uses default text so the thick stroke doesn't dominate the translucent fill.
		case 3: { const h = (Date.now() * 0.1) % 360; return `hsl(${h}, 80%, 60%)`; }
		case 4: return "rgba(122,211,219,0.55)";   // ethereal — translucent legendary cyan.
		default: return undefined;   // falls back to default white in drawText.
	}
}

// Top-middle menu: three buttons (Settings / Achievements / Gallery). Settings
// opens a dropdown of the FX toggles (Shape, Bullet, Damage). Achievements and
// Gallery open empty placeholder panels for now.
const TOP_MENU_BUTTONS = [
	{ key: "settings",     label: "Settings (E)",     color: "#3ca4cb" },
	{ key: "achievements", label: "Achievements (O)", color: "#efc74b" },
	{ key: "gallery",      label: "Gallery (G)",      color: "#8d6adf" },
];
function topMenuLayout() {
	const s = game.scale;
	const w = 170 * s;
	const h = 50 * s;
	const gap = 8 * s;
	// Sit immediately to the right of the Save (x=6..106) and Load (x=106..206)
	// buttons in the top bar.
	const xStart = 206 * s + gap;
	const y = 6 * s;
	return { s, w, h, gap, xStart, y };
}
function renderTopMiddleMenu() {
	const ctx = game.ctx;
	const { s, w, h, gap, xStart, y } = topMenuLayout();
	// Fullscreen panel first so the top buttons render on top and stay clickable.
	if (game.openMenu) {
		ctx.fillStyle = "rgba(20,20,28,0.92)";
		ctx.fillRect(0, 0, game.width, game.height);
	}
	for (let i = 0; i < TOP_MENU_BUTTONS.length; i++) {
		const b = TOP_MENU_BUTTONS[i];
		const x = xStart + i * (w + gap);
		const active = game.openMenu === b.key;
		const hovered = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
		const pressed = hovered && mouse.left;
		drawTwoToneRect(ctx, x, y, w, h, b.color, hovered, pressed, s);
		drawText(ctx, b.label, x + w / 2, y + h / 2, false, true, true, 22 * s);
		// While a menu is open, only the active button stays at full brightness
		// — the other top buttons get the same dark overlay as the background.
		if (game.openMenu && !active) {
			ctx.fillStyle = "rgba(20,20,28,0.55)";
			ctx.fillRect(x, y, w, h);
		}
		if (hovered && mouse.leftRelease) {
			game.openMenu = active ? null : b.key;
			game.gallerySelected = null;   // every open / switch starts at the top-level grid.
			mouse.leftRelease = false;
		}
	}
	renderOpenMenu();
}
function renderOpenMenu() {
	if (!game.openMenu) return;
	const ctx = game.ctx;
	const s = game.scale;
	// Title near the top, below the top buttons.
	const titleText = { settings: "Settings", achievements: "Achievements", gallery: "Gallery" }[game.openMenu];
	drawText(ctx, titleText, game.width / 2, 120 * s, false, true, true, 48 * s);

	if (game.openMenu === "settings") {
		// Three FX toggles, centered in a column under the title.
		const w = 380 * s;
		const h = 60 * s;
		const gap = 18 * s;
		const x = (game.width - w) / 2;
		let y = 220 * s;
		shapeAnimButton.render(ctx, x, y, w, h, "Shape FX: " + (state.shapeDeathAnimEnabled ? "ON" : "OFF"), false);
		y += h + gap;
		bulletAnimButton.render(ctx, x, y, w, h, "Bullet FX: " + (state.bulletDeathAnimEnabled ? "ON" : "OFF"), false);
		y += h + gap;
		damageBlendButton.render(ctx, x, y, w, h, "Damage FX: " + (state.damageBlendEnabled ? "ON" : "OFF"), false);
		y += h + gap + 8 * s;
		renderSettingsStats(ctx, s, y);
	} else if (game.openMenu === "gallery") {
		renderGallery();
	} else if (game.openMenu === "achievements") {
		renderAchievements();
	}
	// ESC closes the menu.
	if (keys.justPressed.has("Escape")) {
		if (game.gallerySelected) game.gallerySelected = null;
		else game.openMenu = null;
	}
}

const RARITY_DISPLAY = { "-1": "Normal", 0: "Shiny", 1: "Legendary", 2: "Shadow", 3: "Rainbow", 4: "Ethereal" };

// Hexagon tier-1 (size 28) is the reference for previews — it fills `maxR`.
// Eggs (size 5) end up about 18% of that. Tiered shapes' natural size grows
// past `maxR`, so we clamp so they don't bleed past their crate.
const PREVIEW_REF_SIZE = 28;
function previewRadius(maxR, type, tier) {
	const sides = TYPE_SIDES[type] ?? 0;
	const baseSize = TYPE_SIZES[type] ?? 20;
	const baseSides = Math.max(3, sides);
	const cosFactor = Math.cos(Math.PI / baseSides);
	const triangleAdjust = sides === 3 && tier > 1 ? 2 / (2 + (tier - 1)) : 1;
	const natural = (baseSize / Math.pow(cosFactor, Math.max(0, tier - 1))) * triangleAdjust;
	const scaled = (natural / PREVIEW_REF_SIZE) * maxR;
	return Math.min(maxR, scaled);
}

// Draw a shape icon for the gallery/achievements: same nested-polygon technique
// as in-world shapes (one stroked polygon per tier-layer, shrunk by cos(π/sides)
// each ring). `maxR` is the largest a shape may render at — eggs come out small
// and tiered hexagons get clamped so they don't bleed past their crate.
function drawGalleryShape(ctx, cx, cy, maxR, type, tier, rarity) {
	const r = previewRadius(maxR, type, tier);
	const data = makeShapeData(type, rarity ?? -1, tier);
	const sides = data.sides;
	let fill = data.color;
	let stroke = darken(data.color);
	if (rarity === 3) {
		const hue = (Date.now() * 0.1) % 360;
		fill = `hsl(${hue}, 80%, 60%)`;
		stroke = `hsl(${hue}, 60%, 35%)`;
	}
	const baseSides = Math.max(3, sides);
	const cosFactor = Math.cos(Math.PI / baseSides);
	ctx.fillStyle = fill;
	ctx.strokeStyle = stroke;
	ctx.lineWidth = 3 * game.scale * game.room.fov;
	ctx.lineJoin = "round";
	for (let i = 0; i < Math.max(1, tier); i++) {
		const layerR = r * Math.pow(cosFactor, i);
		const rot = (i & 1) ? 0 : Math.PI / baseSides;
		ctx.beginPath();
		if (sides === 0) {
			ctx.arc(cx, cy, layerR, 0, Math.PI * 2);
		} else {
			for (let j = 0; j < sides; j++) {
				const a = rot + (j / sides) * Math.PI * 2;
				const px = cx + Math.cos(a) * layerR;
				const py = cy + Math.sin(a) * layerR;
				if (j === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
		}
		ctx.fill();
		ctx.stroke();
	}
}

function renderGallery() {
	const ctx = game.ctx;
	const s = game.scale;
	if (game.gallerySelected) { renderGalleryDetail(); return; }

	const kills = state.galleryKills || {};
	const types = Object.keys(kills).map(Number).sort((a, b) => a - b);
	if (types.length === 0) {
		drawText(ctx, "No shapes killed yet.", game.width / 2, game.height / 2, false, true, true, 28 * s);
		return;
	}
	const startY = 200 * s;
	const rowH = 130 * s;
	const slotW = 110 * s;
	const slotR = 36 * s;
	const leftLabelW = 200 * s;
	let y = startY;
	for (const type of types) {
		if (y > game.height - rowH) break;   // simple clipping; no scroll yet.
		drawText(ctx, TYPE_NAMES[type], 80 * s, y + rowH / 2 - 14 * s, false, true, false, 28 * s);
		const tiers = Object.keys(kills[type]).map(Number).sort((a, b) => a - b);
		let x = 80 * s + leftLabelW;
		for (const tier of tiers) {
			const cx = x + slotW / 2;
			const cy = y + rowH / 2 - 10 * s;
			const hovered = mouse.x >= x && mouse.x <= x + slotW && mouse.y >= y && mouse.y <= y + rowH;
			if (hovered) {
				ctx.fillStyle = "rgba(255,255,255,0.12)";
				ctx.fillRect(x, y, slotW, rowH);
			}
			drawGalleryShape(ctx, cx, cy, slotR, type, tier, -1);
			drawText(ctx, "Tier " + tier, cx, y + rowH - 22 * s, false, true, true, 18 * s);
			if (hovered && mouse.leftRelease) {
				game.gallerySelected = { type, tier };
				mouse.leftRelease = false;
				return;
			}
			x += slotW;
		}
		y += rowH;
	}
}

function renderGalleryDetail() {
	const ctx = game.ctx;
	const s = game.scale;
	const sel = game.gallerySelected;
	const { type, tier } = sel;
	// Back button.
	const bx = 60 * s, by = 180 * s, bw = 130 * s, bh = 50 * s;
	const bHov = mouse.x >= bx && mouse.x <= bx + bw && mouse.y >= by && mouse.y <= by + bh;
	drawTwoToneRect(ctx, bx, by, bw, bh, "#888888", bHov, bHov && mouse.left, s);
	drawText(ctx, "← Back", bx + bw / 2, by + bh / 2, false, true, true, 22 * s);
	if (bHov && mouse.leftRelease) {
		game.gallerySelected = null;
		mouse.leftRelease = false;
		return;
	}
	drawText(ctx, TYPE_NAMES[type] + " — Tier " + tier, game.width / 2, 200 * s, false, true, true, 36 * s);
	const rarities = Object.keys((state.galleryKills[type] || {})[tier] || {}).map(Number).sort((a, b) => a - b);
	if (rarities.length === 0) {
		drawText(ctx, "No rarity records for this combo.", game.width / 2, game.height / 2, false, true, true, 24 * s);
		return;
	}
	const slotW = 180 * s;
	const slotR = 56 * s;
	const totalW = rarities.length * slotW;
	let x = (game.width - totalW) / 2;
	const y = 320 * s;
	for (const rarity of rarities) {
		const cx = x + slotW / 2;
		const cy = y + 80 * s;
		drawGalleryShape(ctx, cx, cy, slotR, type, tier, rarity);
		const label = RARITY_DISPLAY[rarity] ?? "?";
		drawText(ctx, label, cx, y + 170 * s, false, true, true, 22 * s);
		drawText(ctx, "× " + state.galleryKills[type][tier][rarity], cx, y + 200 * s, false, true, true, 18 * s);
		x += slotW;
	}
}

// Click-to-repair: clicking a neutral sanctuary selects it and shows a "Repair
// Sanctuary" button above it. Pressing the button pays e12 score and replaces
// the neutral siege with a real tier-1 sanctuary at the same spot.
const REPAIR_COST = 1e14;
function handleSanctuaryRepair() {
	if (game.mapOverlayOpen || game.debugMode || game.controlledTank) return;
	const ctx = game.ctx;
	const s = game.scale;
	const sc = game.scale * game.room.fov;

	// Selection on click: nearest neutral sanctuary under the cursor.
	if (mouse.leftRelease) {
		let hitNeutral = null;
		for (const sg of game.sieges) {
			if (!sg.neutral) continue;
			const dx = mouse.x - sg.pos.x * sc;
			const dy = mouse.y - sg.pos.y * sc;
			if (Math.sqrt(dx * dx + dy * dy) <= sg.size * sc) { hitNeutral = sg; break; }
		}
		if (hitNeutral) {
			game.selectedSanctuary = hitNeutral;
			mouse.leftRelease = false;
		}
	}

	const sel = game.selectedSanctuary;
	if (!sel || sel.health <= 0 || !game.sieges.includes(sel)) {
		game.selectedSanctuary = null;
		return;
	}
	// Button geometry: sits just above the sanctuary on screen.
	const w = 220 * s;
	const h = 50 * s;
	const x = sel.pos.x * sc - w / 2;
	const y = sel.pos.y * sc - sel.size * sc - 24 * s - h;
	const hovered = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
	const affordable = state.score >= REPAIR_COST;
	const pressed = hovered && mouse.left && affordable;
	const fill = affordable ? "#58b0d0" : "#888";
	const stroke = darken(fill, 0.75);
	ctx.lineWidth = 8 * s;
	ctx.strokeStyle = "#222";
	ctx.strokeRect(x, y, w, h);
	ctx.fillStyle = pressed ? stroke : fill;
	ctx.fillRect(x, y, w, h);
	ctx.fillStyle = pressed ? fill : stroke;
	const darkH = Math.min(h * 0.4, 32 * s);
	ctx.fillRect(x, y + h - darkH, w, darkH);
	if (hovered && affordable) {
		ctx.fillStyle = "rgba(255,255,255,0.1)";
		ctx.fillRect(x, y, w, h);
	}
	drawText(ctx, "Repair Sanctuary", x + w / 2, y + h / 2 - 7 * s, false, true, true, 20 * s);
	drawText(ctx, formatNumber(REPAIR_COST) + " score", x + w / 2, y + h / 2 + 14 * s, !affordable, true, true, 16 * s);
	if (hovered && affordable && mouse.leftRelease) {
		state.score -= REPAIR_COST;
		const idx = game.sieges.indexOf(sel);
		if (idx >= 0) game.sieges.splice(idx, 1);
		game.sieges.push(new Siege(1));
		game.selectedSanctuary = null;
		mouse.leftRelease = false;
	}
	// Clicking elsewhere (handled by leftRelease still being set) deselects.
	if (mouse.leftRelease) game.selectedSanctuary = null;
}

function renderMapTab() {
	checkMap1Unlock();
	if (!state.map1Unlocked) return;
	if (game.mapOverlayOpen) return;
	const ctx = game.ctx;
	const s = game.scale;
	const x = game.width / 2 + 6 * s;
	const w = 320 * 3 * s - 20 * s;
	const h = 50 * s;
	const y = 320 * s - h - 20 * s;   // 20 px above first tab row — matches inter-row gap.
	const hovered = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
	const pressed = hovered && mouse.left;
	drawTwoToneRect(ctx, x, y, w, h, "#3ca4cb", hovered, pressed, s);
	drawText(ctx, "Map  —  " + MAP_AREAS[state.currentMap].label, x + w / 2, y + h / 2, false, true, true, 24 * s);
	if (hovered && mouse.leftRelease) {
		game.mapOverlayOpen = true;
		// Start zoomed in on Origin. Origin is drawn at world (width/2, height/2+40s);
		// to keep it under that screen point at zoom > 1, set pan = world * (1-zoom).
		const zoom = 2;
		const cxOrigin = game.width / 2;
		const cyOrigin = game.height / 2 + 40 * s;
		game.mapZoom = game.mapZoomTarget = zoom;
		game.mapPanX = game.mapPanTargetX = cxOrigin * (1 - zoom);
		game.mapPanY = game.mapPanTargetY = cyOrigin * (1 - zoom);
		game.mapDragging = false;
		game.mapDragMoved = false;
		mouse.leftRelease = false;
	}
}

// Paint the inside of a hex (no border) — called for every tile in the first
// pass so adjacent fills meet flush at shared edges.
function paintHexFill(ctx, cx, cy, r, fill, hovered, pressed) {
	ctx.save();
	hexPath(ctx, cx, cy, r);
	ctx.clip();
	ctx.fillStyle = pressed ? darken(fill, 0.75) : fill;
	ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
	ctx.fillStyle = pressed ? fill : darken(fill, 0.75);
	ctx.fillRect(cx - r, cy + r * 0.2, r * 2, r * 0.8);
	if (hovered) {
		ctx.fillStyle = "rgba(255,255,255,0.12)";
		ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
	}
	ctx.restore();
}
// Stroke the border for one hex — second pass, so the strokes sit cleanly on
// top of all fills and shared edges aren't doubled or cut off by neighbors.
function strokeHexBorder(ctx, s, cx, cy, r) {
	ctx.lineWidth = 12 * s;
	ctx.strokeStyle = "#222";
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	hexPath(ctx, cx, cy, r);
	ctx.stroke();
}

function renderMapOverlay() {
	if (!game.mapOverlayOpen) return;
	const ctx = game.ctx;
	const s = game.scale;
	// Blur the current canvas content by drawing the canvas to itself with a
	// blur filter, then darken to make the continent pop.
	ctx.filter = "blur(8px)";
	ctx.drawImage(game.canvas, 0, 0);
	ctx.filter = "none";
	ctx.fillStyle = "rgba(0,0,0,0.5)";
	ctx.fillRect(0, 0, game.width, game.height);

	// Title.
	const unlockedCount = MAP_AREAS.filter((a) => a.key === 0 || state.map1Unlocked).length;
	drawText(ctx, "Map  —  " + unlockedCount + "/" + MAP_AREAS.length + " areas unlocked",
		game.width / 2, 70 * s, false, true, true, 56 * s);

	// Exit button — top-right "X". ESC also closes (handled at end of function).
	const exitR = 28 * s;
	const exitCX = game.width - 50 * s;
	const exitCY = 50 * s;
	const exitDist = Math.hypot(mouse.x - exitCX, mouse.y - exitCY);
	const exitHovered = exitDist <= exitR;
	ctx.fillStyle = exitHovered ? "#e85a5a" : "#cc3a3a";
	ctx.strokeStyle = "#222";
	ctx.lineWidth = 4 * s;
	ctx.beginPath();
	ctx.arc(exitCX, exitCY, exitR, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
	ctx.strokeStyle = "#fff";
	ctx.lineWidth = 5 * s;
	ctx.beginPath();
	ctx.moveTo(exitCX - exitR / 2, exitCY - exitR / 2);
	ctx.lineTo(exitCX + exitR / 2, exitCY + exitR / 2);
	ctx.moveTo(exitCX + exitR / 2, exitCY - exitR / 2);
	ctx.lineTo(exitCX - exitR / 2, exitCY + exitR / 2);
	ctx.stroke();
	if (exitHovered && mouse.leftRelease) {
		game.mapOverlayOpen = false;
		mouse.leftRelease = false;
		return;
	}

	// Continent: pointy-top hex grid laid out so adjacent tiles share edges.
	const r = 50 * s;
	const stepX = r * Math.sqrt(3);   // horizontal step between neighbors.
	const stepY = r * 1.5;            // vertical step between rows.
	const cx0 = game.width / 2;
	const cy0 = game.height / 2 + 40 * s;
	const areaByKey = new Map(MAP_AREAS.map((a) => [a.q + "," + a.r, a]));

	// Pan + zoom (smoothed like the upgrade-panel scroll: 0.18 lerp each frame).
	if (game.mapZoom == null) {
		game.mapZoom = game.mapZoomTarget = 1;
		game.mapPanX = game.mapPanY = 0;
		game.mapPanTargetX = game.mapPanTargetY = 0;
	}
	const mapTop = 130 * s;   // clip above this so the continent never overlaps the title.
	const overMap = mouse.y >= mapTop && !exitHovered;

	// Drag-to-pan: pick up on leftClick inside the map area; while held, accumulate
	// pointer delta into the pan target. Only treats as a drag if the cursor actually
	// moved past a small threshold, so quick clicks still register as hex-selects.
	if (mouse.leftClick && overMap) {
		game.mapDragging = true;
		game.mapDragMoved = false;
		game.mapDragLastX = mouse.x;
		game.mapDragLastY = mouse.y;
	}
	if (game.mapDragging) {
		const dx = mouse.x - game.mapDragLastX;
		const dy = mouse.y - game.mapDragLastY;
		if (Math.abs(dx) + Math.abs(dy) > 4 * s) game.mapDragMoved = true;
		if (game.mapDragMoved) {
			game.mapPanTargetX += dx;
			game.mapPanTargetY += dy;
		}
		game.mapDragLastX = mouse.x;
		game.mapDragLastY = mouse.y;
		if (!mouse.left) game.mapDragging = false;
	}
	// Wheel-to-zoom: anchor around the pointer so the location under the cursor
	// stays put while scrolling in/out.
	if (mouse.wheelDelta !== 0 && overMap) {
		const factor = Math.pow(0.999, mouse.wheelDelta);
		const newTarget = Math.max(0.4, Math.min(2.5, game.mapZoomTarget * factor));
		// Adjust pan so the point under the cursor is invariant under the zoom change.
		const ratio = newTarget / game.mapZoomTarget;
		game.mapPanTargetX = mouse.x - ratio * (mouse.x - game.mapPanTargetX);
		game.mapPanTargetY = mouse.y - ratio * (mouse.y - game.mapPanTargetY);
		game.mapZoomTarget = newTarget;
		mouse.wheelDelta = 0;
	}
	// Smoothing — same 0.18 lerp as upgradeScroll.
	game.mapPanX += (game.mapPanTargetX - game.mapPanX) * 0.18;
	game.mapPanY += (game.mapPanTargetY - game.mapPanY) * 0.18;
	game.mapZoom += (game.mapZoomTarget - game.mapZoom) * 0.18;

	// Mouse position in the panned/zoomed user space — used for all hex hit-tests.
	const muX = (mouse.x - game.mapPanX) / game.mapZoom;
	const muY = (mouse.y - game.mapPanY) / game.mapZoom;

	// Pre-compute each tile's pixel position (in user space) so we can do three
	// passes (fills, borders, labels+clicks) without redoing the math.
	const placed = CONTINENT.map((tile) => {
		const px = cx0 + stepX * (tile.q + tile.r / 2);
		const py = cy0 + stepY * tile.r;
		const area = areaByKey.get(tile.q + "," + tile.r) || null;
		return { tile, px, py, area };
	});

	// Apply clip (below title) and transform (pan + zoom) for the continent.
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, mapTop, game.width, game.height - mapTop);
	ctx.clip();
	ctx.translate(game.mapPanX, game.mapPanY);
	ctx.scale(game.mapZoom, game.mapZoom);
	// Pass 1: fills (so adjacent tile fills meet flush).
	for (const p of placed) {
		const fill = p.area ? p.area.color : "#5a5a64";
		const hovered = !!p.area && pointInHex(muX, muY, p.px, p.py, r);
		const pressed = hovered && mouse.left;
		paintHexFill(ctx, p.px, p.py, r, fill, hovered, pressed);
	}
	// Pass 2: borders on top, so every hex outline is the same crisp 12*s line.
	for (const p of placed) strokeHexBorder(ctx, s, p.px, p.py, r);
	// Pass 3: labels.
	for (const p of placed) {
		if (!p.area) continue;
		drawText(ctx, p.area.label, p.px, p.py, false, true, true, 14 * s);
		if (state.currentMap === p.area.key) {
			drawText(ctx, "(current)", p.px, p.py + 14 * s, false, true, true, 10 * s);
		}
	}
	ctx.restore();
	// Click resolution: only fires when leftRelease lands inside a real area's hex
	// AND the pointer didn't drag this gesture (so flicks pan, taps select).
	if (mouse.leftRelease && !game.mapDragMoved) {
		for (const p of placed) {
			if (!p.area) continue;
			if (!pointInHex(muX, muY, p.px, p.py, r)) continue;
			if (state.currentMap !== p.area.key) switchToMap(p.area.key);
			game.mapOverlayOpen = false;
			mouse.leftRelease = false;
			break;
		}
	}

	// ESC closes the overlay without switching.
	if (keys.justPressed.has("Escape")) game.mapOverlayOpen = false;
}

// Keyboard hotkeys for the top-bar buttons. Map view (overlay) swallows all
// shortcuts so it can use its own input. S / L only fire outside any menu;
// G / O / E toggle their menus from anywhere.
function handleHotkeys() {
	if (game.mapOverlayOpen) return;
	const altHeld = keys.pressed.has("AltLeft") || keys.pressed.has("AltRight");
	if (altHeld && keys.justPressed.has("KeyS") && !game.openMenu) saveButton.callback();
	if (altHeld && keys.justPressed.has("KeyL") && !game.openMenu) loadButton.callback();
	if (keys.justPressed.has("KeyG")) {
		game.openMenu = game.openMenu === "gallery" ? null : "gallery";
		game.gallerySelected = null;
	}
	if (keys.justPressed.has("KeyO")) {
		game.openMenu = game.openMenu === "achievements" ? null : "achievements";
		game.gallerySelected = null;
	}
	if (keys.justPressed.has("KeyE")) {
		game.openMenu = game.openMenu === "settings" ? null : "settings";
		game.gallerySelected = null;
	}
}

function frame(now) {
	if (lastFrameTime > 0 && now - lastFrameTime > 500) resyncTimersAfterPause(now);
	lastFrameTime = now;
	handleHotkeys();
	const overlayOpen = !!game.mapOverlayOpen;
	// Capture the click state for stat tracking before any suppression kicks in.
	const trackClickThisFrame = mouse.leftClick && !overlayOpen && !game.openMenu;
	game._clickHitShape = false;
	// Wheel over the arena (left half) adjusts the cursor size, clamped to
	// 0.5..1.5× the default. Wheel inside the upgrade panel still feeds the
	// upgrade scroll logic in game.render.
	if (mouse.wheelDelta !== 0 && !overlayOpen && !game.openMenu && mouse.x < game.width / 2) {
		state.cursorSizeMul = Math.max(0.5, Math.min(1.5, (state.cursorSizeMul ?? 1) - mouse.wheelDelta * 0.001));
		mouse.wheelDelta = 0;
	}
	// Settings / Gallery / Achievements: the simulation keeps ticking (so stats
	// shown in Settings stay live), but no mouse-driven interactions can leak
	// through to the game underneath. Save the mouse state, blank it for the
	// game-side block, then restore for the menu UI to read.
	const menuOpen = !!game.openMenu;
	const savedGameClick = mouse.leftClick;
	const savedGameRelease = mouse.leftRelease;
	const savedGameRight = mouse.right;
	const savedGameWheel = mouse.wheelDelta;
	if (menuOpen) {
		mouse.leftClick = false; mouse.leftRelease = false; mouse.right = false; mouse.wheelDelta = 0;
	}
	if (!overlayOpen) {
		// Auto-spawn / despawn the Neutral Sanctuary. The gate lives in mapSwitch.js
		// and is always-true on Crash Zone (so the user can find and repair it).
		const allowNeutral = shouldHaveNeutralSanctuary();
		const neutralIdx = game.sieges.findIndex((s) => s.neutral);
		if (allowNeutral && neutralIdx < 0) {
			game.sieges.push(new Siege(1, { neutral: true }));
		} else if (!allowNeutral && neutralIdx >= 0) {
			game.sieges.splice(neutralIdx, 1);
		}
		// Sentry Spawner suppression: while one is alive, polygon spawns are
		// throttled to 5% of the normal rate (20× longer cooldown between spawns).
		const sentrySpawnerAlive = game.shapes.some((s) => s.isSentrySpawner && !(s.isFullyDead && s.isFullyDead()));
		const spawnRateMul = sentrySpawnerAlive ? 20 : 1;
		while (state.shapeSpawningEnabled && game.shapes.length < state.shapesCap && now > nextSpawnTime) {
			game.shapes.push(Shape.random());
			if (game.shapes.length === state.shapesCap) nextSpawnTime = now;
			nextSpawnTime += (0.5 + Math.random() * 0.5) * Math.max(500, state.shapesSpawnInterval) * spawnRateMul;
		}
		updateDebug();
		handleTankClicks();
		game.update();
	}
	if (menuOpen) {
		mouse.leftClick = savedGameClick;
		mouse.leftRelease = savedGameRelease;
		mouse.right = savedGameRight;
		mouse.wheelDelta = savedGameWheel;
	}
	if (trackClickThisFrame) {
		if (game._clickHitShape) state.statShapeClicks++;
		else state.statClickMisses++;
	}
	// Achievement progress is checked every frame — cheap, just compares
	// counters against thresholds. Newly unlocked entries push a toast.
	checkAchievements();
	// While the overlay is open, suppress mouse clicks so background buttons /
	// tabs / upgrade rows don't fire when the user clicks a hexagon. Saved
	// values are restored before renderMapOverlay so its own hit-tests still work.
	// Suppression happens *before* game.render() so the upgrade panel inside it
	// also stops processing clicks.
	const savedClick = mouse.leftClick;
	const savedRelease = mouse.leftRelease;
	const savedWheel = mouse.wheelDelta;
	if (overlayOpen || game.openMenu) { mouse.leftClick = false; mouse.leftRelease = false; mouse.wheelDelta = 0; }
	game.render(drawText);
	if (!overlayOpen && !game.openMenu) handleSanctuaryRepair();
	try {
		saveButton.render(game.ctx, 6 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Save (S)", false);
		loadButton.render(game.ctx, 106 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Load (L)", false);
		renderDebugPanel(game.ctx);
		renderMapTab();
		renderTankUpgradePanel();
		const hoveredTank = game.selectedTank;
		const hovered = hoveredTank ? null : shapeUnderMouse();
		if (hoveredTank) {
			renderTankInfoPanel(hoveredTank);
		} else if (hovered) {
			const s = game.scale;
			const lineH = 28 * s;
			const x = 12 * s;
			const rarityNames = ["Shiny", "Legendary", "Shadow", "Rainbow", "Ethereal"];
			const rarityLabel = hovered.rarity >= 0 ? rarityNames[hovered.rarity] + " " : "";
			const yBase = game.height - 12 * s - lineH * 3;
			const hpDisplay = " - " + Math.max(0, Math.floor(hovered.health)) + "/" + hovered.maxHealth;
			// Gem shapes use a gemstone naming convention. The leading rarity
			// label ("Shiny ", "Legendary ", ...) still prepends, e.g.
			// "Shiny Amethyst". Types without a gemstone alias fall back to
			// "Gem <Polygon>" so debug-spawned Heptagon/Octagon/Nonagon gems
			// still read sensibly.
			const GEM_NAMES = ["Pearl", "Topaz", "Citrine", "Amethyst", "Aquamarine"];
			let typeName;
			if (hovered.isSentry) typeName = "Sentry";
			else if (hovered.isGold) typeName = "Golden " + TYPE_NAMES[hovered.type];
			else if (hovered.isGem) typeName = GEM_NAMES[hovered.type] ?? ("Gem " + TYPE_NAMES[hovered.type]);
			else typeName = TYPE_NAMES[hovered.type];
			// Rarity-themed fill for the main hover line; stroke stays default.
			drawText(game.ctx, rarityLabel + typeName + hpDisplay, x, yBase, false, true, false, 28 * s, rarityTextFill(hovered.rarity, hovered.isGold, hovered.isGem));
			if (!hovered.isSentry) drawText(game.ctx, "Tier " + hovered.layers, x, yBase + lineH, false, true, false, 24 * s);
			drawText(game.ctx, formatNumber(hovered.score) + " score", x, yBase + lineH * 2, false, true, false, 24 * s);
		}
		// Top-middle menu renders LAST so its fullscreen panels sit on top of the
		// map tab, save/load, debug panel, and everything else. When a menu is
		// open we restore the real mouse state so the top buttons + the open
		// panel's controls (settings toggles) stay interactive.
		if (game.openMenu && !overlayOpen) {
			mouse.leftClick = savedClick;
			mouse.leftRelease = savedRelease;
			mouse.wheelDelta = savedWheel;
		}
		renderTopMiddleMenu();
	} catch (e) {
		console.error(e);
	}
	if (overlayOpen) {
		mouse.leftClick = savedClick;
		mouse.leftRelease = savedRelease;
		mouse.wheelDelta = savedWheel;
		try { renderMapOverlay(); } catch (e) { console.error(e); }
	}
	// Achievement toasts render on top of everything but only outside of any
	// menu/overlay (they're noisy and the user is reading a panel otherwise).
	if (!overlayOpen && !game.openMenu) {
		try { renderAchievementToasts(); } catch (e) { console.error(e); }
	}
	mouse.resetClicks();
	keys.resetFrame();
	requestAnimationFrame(frame);
}

frame(0);
