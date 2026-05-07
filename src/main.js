import { state } from "./state.js";
import { mouse } from "./input.js";
import { game } from "./game.js";
import { Room } from "./room.js";
import { Button } from "./button.js";
import { Shape } from "./shape.js";
import { drawText } from "./render.js";
import { tabs, generalTab } from "./tabs.js";
import { encode, decode, saveToStorage, loadFromStorage } from "./save.js";
import { renderDebugPanel } from "./debug.js";

game.init({ Room, tabs, generalTab });

loadFromStorage();
setInterval(saveToStorage, 5000);
window.addEventListener("beforeunload", saveToStorage);

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
	game.update();
	game.render(drawText);
	try {
		saveButton.render(game.ctx, 6 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Save", false);
		loadButton.render(game.ctx, 106 * game.scale, 6 * game.scale, 100 * game.scale, 50 * game.scale, "Load", false);
		renderDebugPanel(game.ctx);
	} catch (e) {
		console.error(e);
	}
	mouse.resetClicks();
	requestAnimationFrame(frame);
}

frame(0);
