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
import { syncTanks, tankUnderMouse, renderTankPreview, snapshotTanks } from "./tank.js";
import { TANK_DEFS } from "./tankDefs.js";
import { formatNumber } from "./utils.js";

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
			game.controlledTank = game.controlledTank === t ? null : t;
			game.selectedTank = null;
			mouse.leftClick = false;
			return;
		}
		if (t) mouse.leftClick = false;
	}
	if (game.controlledTank) return;
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

game.init({ Room, tabs, generalTab });

loadFromStorage();
syncTanks();
onBeforeSave(snapshotTanks);
enableAutoSave();

game.resize();
window.addEventListener("resize", () => game.resize());
document.body.appendChild(game.canvas);

const saveButton = new Button(() => prompt("Copy the save", encode()), "#3085db");
const loadButton = new Button(() => {
	const data = prompt("Load save");
	if (data) {
		decode(data);
		saveToStorage();
	}
}, "#db9146");
const shapeAnimButton = new Button(() => { state.shapeDeathAnimEnabled = !state.shapeDeathAnimEnabled; }, "#efc74b");
const bulletAnimButton = new Button(() => { state.bulletDeathAnimEnabled = !state.bulletDeathAnimEnabled; }, "#58b0d0");

let nextSpawnTime = 0;

function frame(now) {
	while (game.shapes.length < state.shapesCap && now > nextSpawnTime) {
		game.shapes.push(Shape.random());
		if (game.shapes.length === state.shapesCap) nextSpawnTime = now;
		nextSpawnTime += (0.5 + Math.random() * 0.5) * Math.max(500, state.shapesSpawnInterval);
	}
	updateDebug();
	handleTankClicks();
	game.update();
	game.render(drawText);
	try {
		saveButton.render(game.ctx, 6 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Save", false);
		loadButton.render(game.ctx, 106 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Load", false);
		shapeAnimButton.render(game.ctx, 206 * game.scale, 6 * game.scale, 160 * game.scale, 50 * game.scale, "Shape FX: " + (state.shapeDeathAnimEnabled ? "ON" : "OFF"), false);
		bulletAnimButton.render(game.ctx, 366 * game.scale, 6 * game.scale, 160 * game.scale, 50 * game.scale, "Bullet FX: " + (state.bulletDeathAnimEnabled ? "ON" : "OFF"), false);
		renderDebugPanel(game.ctx);
		renderTankUpgradePanel();
		const hoveredTank = game.selectedTank;
		const hovered = hoveredTank ? null : shapeUnderMouse();
		if (hoveredTank) {
			const s = game.scale;
			const lineH = 28 * s;
			const x = 12 * s;
			const yBase = game.height - 12 * s - lineH * 2;
			drawText(game.ctx, hoveredTank.classification, x, yBase, false, true, false, 28 * s);
			drawText(
				game.ctx,
				"Lvl " + hoveredTank.level + " (" + formatNumber(hoveredTank.xpProgress()) + "/" + formatNumber(hoveredTank.xpNeeded()) + ")",
				x,
				yBase + lineH,
				false,
				true,
				false,
				24 * s,
			);
		} else if (hovered) {
			const s = game.scale;
			const lineH = 28 * s;
			const x = 12 * s;
			const rarityNames = ["Shiny", "Legendary", "Shadow", "Rainbow", "Ethereal"];
			const rarityLabel = hovered.rarity >= 0 ? rarityNames[hovered.rarity] + " " : "";
			const yBase = game.height - 12 * s - lineH * 3;
			const hpDisplay = " - " + Math.max(0, Math.floor(hovered.health)) + "/" + hovered.maxHealth;
			drawText(game.ctx, rarityLabel + TYPE_NAMES[hovered.type] + hpDisplay, x, yBase, false, true, false, 28 * s);
			drawText(game.ctx, "Tier " + hovered.layers, x, yBase + lineH, false, true, false, 24 * s);
			drawText(game.ctx, formatNumber(hovered.score) + " score", x, yBase + lineH * 2, false, true, false, 24 * s);
		}
	} catch (e) {
		console.error(e);
	}
	mouse.resetClicks();
	keys.resetFrame();
	requestAnimationFrame(frame);
}

frame(0);
