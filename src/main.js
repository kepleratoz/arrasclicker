import { state } from "./state.js";
import { mouse, keys } from "./input.js";
import { game } from "./game.js";
import { Room } from "./room.js";
import { Button } from "./button.js";
import { Shape, TYPE_NAMES } from "./shape.js";
import { drawText } from "./render.js";
import { tabs, generalTab } from "./tabs.js";
import { encode, decode, saveToStorage, loadFromStorage, enableAutoSave } from "./save.js";
import { renderDebugPanel, updateDebug, shapeUnderMouse } from "./debug.js";
import { syncTanks, tankUnderMouse, renderTankPreview } from "./tank.js";
import { TANK_DEFS } from "./tankDefs.js";
import { formatNumber } from "./utils.js";

function getTankUpgradeButtons() {
	const tank = game.selectedTank;
	if (!tank) return [];
	const def = TANK_DEFS[tank.defKey];
	if (!def.upgrades || !tank.canUpgrade()) return [];
	const s = game.scale;
	const w = 200 * s;
	const h = 70 * s;
	const margin = 6 * s;
	const x = game.width - w - margin;
	const buttons = [];
	for (let i = 0; i < def.upgrades.length; ++i) {
		buttons.push({ defKey: def.upgrades[i], x, y: margin + i * (h + 4 * s), w, h });
	}
	return buttons;
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
		const buttons = getTankUpgradeButtons();
		for (const b of buttons) {
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
	const buttons = getTankUpgradeButtons();
	if (buttons.length === 0) return;
	const ctx = game.ctx;
	const s = game.scale;
	for (const b of buttons) {
		const hovered = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
		ctx.lineWidth = 8 * s;
		ctx.strokeStyle = "#222";
		ctx.strokeRect(b.x, b.y, b.w, b.h);
		ctx.fillStyle = hovered ? "#3a8ed6" : "#2a2a2a";
		ctx.fillRect(b.x, b.y, b.w, b.h);
		const previewSize = (b.h - 16 * s) / 2;
		const previewX = b.x + previewSize + 12 * s;
		const previewY = b.y + b.h / 2;
		const fakeTank = { defKey: b.defKey, gunStates: TANK_DEFS[b.defKey].guns.map(() => null) };
		renderTankPreview(ctx, fakeTank, previewX, previewY, previewSize);
		drawText(ctx, TANK_DEFS[b.defKey].label, b.x + previewSize * 2 + 24 * s, b.y + b.h / 2, false, true, false, 22 * s);
	}
}

game.init({ Room, tabs, generalTab });

loadFromStorage();
syncTanks();
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

let nextSpawnTime = 0;

function frame(now) {
	while (game.shapes.length < state.shapesCap && now > nextSpawnTime) {
		game.shapes.push(Shape.random());
		if (game.shapes.length === state.shapesCap) nextSpawnTime = now;
		nextSpawnTime += (0.5 + Math.random() * 0.5) * Math.max(1000, state.shapesSpawnInterval);
	}
	updateDebug();
	handleTankClicks();
	game.update();
	game.render(drawText);
	try {
		saveButton.render(game.ctx, 6 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Save", false);
		loadButton.render(game.ctx, 106 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Load", false);
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
			const yBase = game.height - 12 * s - lineH * 3;
			drawText(game.ctx, TYPE_NAMES[hovered.type], x, yBase, false, true, false, 28 * s);
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
