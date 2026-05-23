import { state } from "./state.js";
import { mouse, keys } from "./input.js";
import { game } from "./game.js";
import { Room } from "./room.js";
import { Button } from "./button.js";
import { Shape, TYPE_NAMES } from "./shape.js";
import { drawText } from "./render.js";
import { tabs, generalTab } from "./tabs.js";
import { encode, decode, saveToStorage, loadFromStorage, enableAutoSave, onBeforeSave } from "./save.js";
import { renderDebugPanel, updateDebug, shapeUnderMouse } from "./debug.js";
import { syncTanks, tankUnderMouse, renderTankPreview, snapshotTanks, TANK_UPGRADE_SPECS, tankUpgradeCost, tankSkillPointsSpent, tankSkillPointsCap, tankSkillPointsRemaining } from "./tank.js";
import { Siege } from "./siege.js";
import { TANK_DEFS } from "./tankDefs.js";
import { formatNumber, darken, colors } from "./utils.js";
import { switchToMap, checkMap1Unlock, hasSanctuaryOnMap0 } from "./mapSwitch.js";

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
syncTanks();
// Sanctuary no longer auto-spawns; toggle it via the debug panel.
onBeforeSave(snapshotTanks);
enableAutoSave();

game.resize();
window.addEventListener("resize", () => game.resize());
document.body.appendChild(game.canvas);

const saveButton = new Button(() => prompt("Copy the save", encode()), "#3085db");
const loadButton = new Button(() => {
	const data = prompt("Load save");
	if (!data) return;
	try {
		decode(data);
		saveToStorage();
	} catch (e) {
		console.error("Load failed:", e);
		alert("Couldn't load that save — " + (e && e.message ? e.message : "data couldn't be parsed") + "\n\nTip: re-copy the full string and try again.");
	}
}, "#db9146");
const shapeAnimButton = new Button(() => { state.shapeDeathAnimEnabled = !state.shapeDeathAnimEnabled; }, "#efc74b");
const bulletAnimButton = new Button(() => { state.bulletDeathAnimEnabled = !state.bulletDeathAnimEnabled; }, "#58b0d0");
const damageBlendButton = new Button(() => { state.damageBlendEnabled = !state.damageBlendEnabled; }, "#e03e41");

let nextSpawnTime = 0;

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
const CONTINENT = (() => {
	const out = [];
	const rand = mulberry32(0xC0FFEE);
	for (let q = -6; q <= 6; q++) {
		for (let r = -6; r <= 6; r++) {
			const dist = (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2;
			if (dist <= 4) out.push({ q, r });
			else if (dist === 5 && rand() < 0.65) out.push({ q, r });
			else if (dist === 6 && rand() < 0.22) out.push({ q, r });
		}
	}
	// Ensure every real area's tile is included even if its slot was rolled out.
	const have = new Set(out.map((t) => t.q + "," + t.r));
	for (const a of MAP_AREAS) {
		const k = a.q + "," + a.r;
		if (!have.has(k)) { out.push({ q: a.q, r: a.r }); have.add(k); }
	}
	return out;
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
		// Reset pan + zoom so each open lands centered.
		game.mapZoom = game.mapZoomTarget = 1;
		game.mapPanX = game.mapPanY = 0;
		game.mapPanTargetX = game.mapPanTargetY = 0;
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

function frame(now) {
	const overlayOpen = !!game.mapOverlayOpen;
	if (!overlayOpen) {
		// Auto-spawn / despawn the Neutral Sanctuary (see commentary above renderMapOverlay).
		const allowNeutral = state.arenaFovUpgrades >= 1 && hasSanctuaryOnMap0();
		const neutralIdx = game.sieges.findIndex((s) => s.neutral);
		if (allowNeutral && neutralIdx < 0) {
			game.sieges.push(new Siege(1, { neutral: true }));
		} else if (!allowNeutral && neutralIdx >= 0) {
			game.sieges.splice(neutralIdx, 1);
		}
		while (state.shapeSpawningEnabled && game.shapes.length < state.shapesCap && now > nextSpawnTime) {
			game.shapes.push(Shape.random());
			if (game.shapes.length === state.shapesCap) nextSpawnTime = now;
			nextSpawnTime += (0.5 + Math.random() * 0.5) * Math.max(500, state.shapesSpawnInterval);
		}
		updateDebug();
		handleTankClicks();
		game.update();
	}
	game.render(drawText);
	// While the overlay is open, suppress mouse clicks so background buttons /
	// tabs don't fire when the user clicks a hexagon. Saved values are restored
	// before renderMapOverlay so its own hit-tests still work.
	const savedClick = mouse.leftClick;
	const savedRelease = mouse.leftRelease;
	const savedWheel = mouse.wheelDelta;
	if (overlayOpen) { mouse.leftClick = false; mouse.leftRelease = false; mouse.wheelDelta = 0; }
	try {
		saveButton.render(game.ctx, 6 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Save", false);
		loadButton.render(game.ctx, 106 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Load", false);
		shapeAnimButton.render(game.ctx, 206 * game.scale, 6 * game.scale, 160 * game.scale, 50 * game.scale, "Shape FX: " + (state.shapeDeathAnimEnabled ? "ON" : "OFF"), false);
		bulletAnimButton.render(game.ctx, 366 * game.scale, 6 * game.scale, 160 * game.scale, 50 * game.scale, "Bullet FX: " + (state.bulletDeathAnimEnabled ? "ON" : "OFF"), false);
		damageBlendButton.render(game.ctx, 526 * game.scale, 6 * game.scale, 160 * game.scale, 50 * game.scale, "Damage FX: " + (state.damageBlendEnabled ? "ON" : "OFF"), false);
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
			const typeName = hovered.isSentry ? "Sentry" : TYPE_NAMES[hovered.type];
			drawText(game.ctx, rarityLabel + typeName + hpDisplay, x, yBase, false, true, false, 28 * s);
			if (!hovered.isSentry) drawText(game.ctx, "Tier " + hovered.layers, x, yBase + lineH, false, true, false, 24 * s);
			drawText(game.ctx, formatNumber(hovered.score) + " score", x, yBase + lineH * 2, false, true, false, 24 * s);
		}
	} catch (e) {
		console.error(e);
	}
	if (overlayOpen) {
		mouse.leftClick = savedClick;
		mouse.leftRelease = savedRelease;
		mouse.wheelDelta = savedWheel;
		try { renderMapOverlay(); } catch (e) { console.error(e); }
	}
	mouse.resetClicks();
	keys.resetFrame();
	requestAnimationFrame(frame);
}

frame(0);
