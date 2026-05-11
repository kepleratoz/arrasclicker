import { state } from "./state.js";
import { mouse, keys } from "./input.js";
import { formatNumber } from "./utils.js";

function bulkQuantity() {
	if (keys.pressed.has("AltLeft") || keys.pressed.has("AltRight")) return 100;
	if (keys.pressed.has("ShiftLeft") || keys.pressed.has("ShiftRight")) return 10;
	return 1;
}

function simulateBuy(game, upgrade, n) {
	const snapshot = JSON.stringify(state);
	const tanksCount = game.tanks.length;
	let total = 0;
	let actual = 0;
	try {
		for (let i = 0; i < n; i++) {
			if (upgrade.isDisabled()) break;
			total += upgrade.cost();
			upgrade.button.callback();
			actual++;
		}
	} finally {
		const parsed = JSON.parse(snapshot);
		for (const key of Object.keys(parsed)) state[key] = parsed[key];
		while (game.tanks.length > tanksCount) game.tanks.pop();
	}
	return { total, actual };
}

class Game {
	constructor() {
		this.canvas = document.createElement("canvas");
		this.ctx = this.canvas.getContext("2d");
		this.width = 0;
		this.height = 0;
		this.scale = 1;
		this.shapes = [];
		this.tanks = [];
		this.sieges = [];
		this.flyingText = [];
		// `room`, `tabs`, `currentTab` are wired up in init() after circular imports settle.
		this.room = null;
		this.tabs = [];
		this.currentTab = null;
		this.debugMode = null; // null | "spawn" | "upgrade"
		this.debugSelectedShape = null;
		this.selectedTank = null;
		this.controlledTank = null;
		this.upgradeScroll = 0;
		this.upgradeScrollTarget = 0;
		this.scrolledTab = null;
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
			if (shape.isFullyDead()) this.shapes.splice(i, 1);
		}
		for (const tank of this.tanks) tank.update();
		for (const siege of this.sieges) siege.update();
		// Mutual-damage pass: any friendly bullet (tank or sanctuary, including heal bullets
		// which carry damage 0) collides with sentry bullets and both sides take damage.
		const friendlyBulletGroups = [];
		for (const tank of this.tanks) friendlyBulletGroups.push(tank.bullets);
		for (const siege of this.sieges) friendlyBulletGroups.push(siege.bullets);
		for (const group of friendlyBulletGroups) {
			for (const ob of group) {
				if (ob.dying) continue;
				for (const sh of this.shapes) {
					if (!sh.isSentry || !sh.bullets) continue;
					for (const sb of sh.bullets) {
						if (sb.dying) continue;
						const dx = sb.pos.x - ob.pos.x;
						const dy = sb.pos.y - ob.pos.y;
						if (Math.sqrt(dx * dx + dy * dy) < sb.size + ob.size) {
							sb.health -= ob.damage;
							ob.health -= sb.damage;
							if (sb.health <= 0) sb.startDying();
							if (ob.health <= 0) { ob.startDying(); break; }
						}
					}
					if (ob.dying) break;
				}
			}
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

		for (const siege of this.sieges) siege.render(ctx);
		for (const shape of this.shapes) shape.render(ctx);
		for (const tank of this.tanks) tank.render(ctx);

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

		if (this.currentTab !== this.scrolledTab) {
			this.upgradeScroll = 0;
			this.upgradeScrollTarget = 0;
			this.scrolledTab = this.currentTab;
		}
		const regionX = this.width / 2 + 6 * this.scale;
		const regionW = (320 * 3 - 20) * this.scale;
		const regionTop = 530 * this.scale;
		const regionBottom = this.height - 8 * this.scale;
		const upgradeSpacing = 100 * this.scale;
		const totalContentH = this.currentTab.upgrades.length * upgradeSpacing;
		const maxScroll = Math.max(0, totalContentH - (regionBottom - regionTop));
		if (mouse.wheelDelta && mouse.x >= regionX && mouse.x <= regionX + regionW && mouse.y >= regionTop) {
			this.upgradeScrollTarget = Math.max(0, Math.min(maxScroll, this.upgradeScrollTarget + mouse.wheelDelta));
		}
		this.upgradeScrollTarget = Math.max(0, Math.min(maxScroll, this.upgradeScrollTarget));
		this.upgradeScroll += (this.upgradeScrollTarget - this.upgradeScroll) * 0.18;
		if (Math.abs(this.upgradeScrollTarget - this.upgradeScroll) < 0.4) this.upgradeScroll = this.upgradeScrollTarget;
		ctx.save();
		ctx.beginPath();
		const clipPad = 12 * this.scale;
		ctx.rect(regionX - clipPad, regionTop - clipPad, regionW + clipPad * 2, regionBottom - regionTop + clipPad * 2);
		ctx.clip();
		for (let i = 0; i < this.currentTab.upgrades.length; ++i) {
			const upgrade = this.currentTab.upgrades[i];
			const x = regionX;
			const y = regionTop + i * upgradeSpacing - this.upgradeScroll;
			const w = regionW;
			const h = 80 * this.scale;
			if (y + h < regionTop || y > regionBottom) continue;

			const supportsBulk = typeof upgrade.cost === "function";
			const desired = supportsBulk ? bulkQuantity() : 1;
			let secondary = upgrade.getSecondary();
			let canAffordAll = !upgrade.isDisabled();
			if (supportsBulk && desired > 1 && canAffordAll) {
				const sim = simulateBuy(this, upgrade, desired);
				if (sim.actual === desired) {
					secondary = formatNumber(sim.total) + " score (x" + desired + ")";
				} else {
					canAffordAll = false;
				}
			}
			const effectivelyDisabled = !canAffordAll;
			const hovered = !effectivelyDisabled && mouse.x > x && mouse.y > y && mouse.x < x + w && mouse.y < y + h;
			const willFire = hovered && mouse.leftRelease;

			upgrade.button.render(ctx, x, y, w, h, "", effectivelyDisabled);
			if (willFire && desired > 1) {
				for (let k = 1; k < desired; k++) {
					if (upgrade.isDisabled()) break;
					upgrade.button.callback();
				}
			}
			drawText(ctx, upgrade.getLabel(), x + 8 * this.scale, y + 8 * this.scale, false, true, false, 32 * this.scale);
			drawText(ctx, secondary, x + 8 * this.scale, y + 52 * this.scale, false, true, false, 24 * this.scale);
		}
		ctx.restore();

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
