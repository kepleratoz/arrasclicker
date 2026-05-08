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
import { syncTanks, tankUnderMouse } from "./tank.js";
import { formatNumber } from "./utils.js";

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
		nextSpawnTime += (0.5 + Math.random() * 0.5) * state.shapesSpawnInterval;
	}
	updateDebug();
	game.update();
	game.render(drawText);
	try {
		saveButton.render(game.ctx, 6 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Save", false);
		loadButton.render(game.ctx, 106 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Load", false);
		renderDebugPanel(game.ctx);
		const hoveredTank = tankUnderMouse();
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
