import { state } from "./state.js";
import { mouse } from "./input.js";
import { formatNumber } from "./utils.js";

class Game {
	constructor() {
		this.canvas = document.createElement("canvas");
		this.ctx = this.canvas.getContext("2d");
		this.width = 0;
		this.height = 0;
		this.scale = 1;
		this.shapes = [];
		this.flyingText = [];
		// `room`, `tabs`, `currentTab` are wired up in init() after circular imports settle.
		this.room = null;
		this.tabs = [];
		this.currentTab = null;
		this.debugMode = null; // null | "spawn" | "upgrade"
		this.debugSelectedShape = null;
	}

	init({ Room, tabs, generalTab }) {
		this.room = new Room();
		this.tabs = tabs;
		this.currentTab = generalTab;
	}

	update() {
		this.room.update();
		for (let i = this.shapes.length - 1; i > -1; --i) {
			const shape = this.shapes[i];
			shape.update();
			for (const other of this.shapes) {
				if (shape === other || other.isDead()) continue;
				shape.collide(other);
			}
			if (shape.isDead()) this.shapes.splice(i, 1);
		}
		for (let i = this.flyingText.length - 1; i > -1; --i) {
			const ft = this.flyingText[i];
			ft.y -= 1;
			ft.alpha -= 0.01;
			if (ft.alpha <= 0) this.flyingText.splice(i, 1);
		}
	}

	render(drawText) {
		const ctx = this.ctx;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		this.room.render(ctx);

		for (const shape of this.shapes) shape.render(ctx);

		for (const ft of this.flyingText) {
			ctx.globalAlpha = ft.alpha;
			drawText(ctx, ft.text, ft.x, ft.y, false, false, true, 32 * this.scale);
		}
		ctx.globalAlpha = 1;

		// Cursor indicator
		ctx.beginPath();
		ctx.arc(mouse.x, mouse.y, mouse.right ? 100 : 10, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(60,60,60,0.25)";
		ctx.fill();

		let visibleIdx = 0;
		for (let i = 0; i < this.tabs.length; ++i) {
			const tab = this.tabs[i];
			if (!tab.isUnlocked || tab.isUnlocked()) {
				tab.render(
					ctx,
					(visibleIdx % 3) * 320 * this.scale,
					((visibleIdx / 3) | 0) * 70 * this.scale,
				);
				visibleIdx += 1;
			}
		}

		for (let i = 0; i < this.currentTab.upgrades.length; ++i) {
			const upgrade = this.currentTab.upgrades[i];
			const x = this.width / 2 + 6 * this.scale;
			const y = (530 + 100 * i) * this.scale;
			upgrade.button.render(
				ctx,
				x,
				y,
				(320 * 3 - 20) * this.scale,
				80 * this.scale,
				"",
				upgrade.isDisabled(),
			);
			drawText(ctx, upgrade.getLabel(), x + 8 * this.scale, y + 8 * this.scale, false, true, false, 32 * this.scale);
			drawText(
				ctx,
				upgrade.getSecondary(),
				x + 8 * this.scale,
				y + 52 * this.scale,
				false,
				true,
				false,
				24 * this.scale,
			);
		}

		drawText(ctx, "You have " + formatNumber(state.score) + " score", this.width / 2, 120 * this.scale, false, true, true, 48 * this.scale);
		drawText(
			ctx,
			"Shapes: " + this.shapes.length + "/" + state.shapesCap,
			this.width / 2,
			(120 + 48 / 2 + 16) * this.scale,
			this.shapes.length === state.shapesCap,
			true,
			true,
			24 * this.scale,
		);
	}

	resize() {
		const dpr = window.devicePixelRatio;
		this.width = window.innerWidth * dpr;
		this.height = window.innerHeight * dpr;
		this.canvas.width = this.width;
		this.canvas.height = this.height;
		this.scale = Math.min(this.width / 1920, this.height / 1080);
	}
}

export const game = new Game();
