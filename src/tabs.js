import { state } from "./state.js";
import { Button } from "./button.js";
import { darken } from "./utils.js";
import { drawPolygon } from "./render.js";
import { makeShapeData } from "./shape.js";
import { game } from "./game.js";
import { generalUpgrades, eggUpgrades, squareUpgrades, triangleUpgrades, pentagonUpgrades, hexagonUpgrades, tankUpgrades, clickUpgrades } from "./upgrades.js";

export class Tab {
	constructor(name, upgrades, color, logo, isUnlocked) {
		this.name = name;
		this.upgrades = upgrades;
		this.color = color;
		this.logo = logo;
		this.isUnlocked = isUnlocked;
		this.btn = new Button(() => { game.currentTab = this; }, this.color);
	}
	render(ctx, x, y) {
		const bx = x + game.width / 2 + 6 * game.scale;
		const by = y + 320 * game.scale;
		const w = 300 * game.scale;
		const h = 50 * game.scale;
		this.btn.render(ctx, bx, by, w, h, this.name, game.currentTab === this);
		if (this.logo) {
			const logo = this.logo;
			const inv = 1 / game.scale / game.room.fov;
			drawPolygon(
				ctx,
				(bx + 26) * inv,
				(by + h / 2) * inv,
				Math.min(20, logo.size * 2) * inv * game.scale,
				Math.PI / 4,
				logo.sides,
			);
			ctx.fillStyle = logo.color;
			ctx.strokeStyle = darken(logo.color);
			ctx.lineWidth = 4 * game.scale;
			ctx.fill();
			ctx.stroke();
		}
	}
}

export const generalTab = new Tab("General", generalUpgrades, "#3ca4cb");
export const clickTab = new Tab("Click", clickUpgrades, "#3085db");
export const eggTab = new Tab("Egg", eggUpgrades, "#e8ebf7", makeShapeData(0, -1, 1));
export const squareTab = new Tab("Square", squareUpgrades, "#efc74b", makeShapeData(1, -1, 1), () => state.squaresUnlocked);
export const triangleTab = new Tab("Triangle", triangleUpgrades, "#e7896d", makeShapeData(2, -1, 1), () => state.trianglesUnlocked);
export const pentagonTab = new Tab("Pentagon", pentagonUpgrades, "#8d6adf", makeShapeData(3, -1, 1), () => state.pentagonsUnlocked);
export const hexagonTab = new Tab("Hexagon", hexagonUpgrades, "#7adbba", makeShapeData(4, -1, 1), () => state.hexagonsUnlocked);
export const tankTab = new Tab("Tank Upgrades", tankUpgrades, "#58b0d0", null, () => state.tankCount >= 1);
tankTab.reorderable = true;   // filters in this tab can be drag-reordered in the upgrade panel.

export const tabs = [
	generalTab,
	clickTab,
	eggTab,
	squareTab,
	triangleTab,
	pentagonTab,
	hexagonTab,
	tankTab,
];
