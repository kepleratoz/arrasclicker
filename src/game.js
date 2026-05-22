import { state } from "./state.js";
import { mouse, keys } from "./input.js";
import { formatNumber, colors, darken } from "./utils.js";

// OSA portal-particle timing: alpha climbs +0.06 per game tick (≈30 ticks/sec) up to 0.9,
// then snaps off. At 60fps that's ≈0.03/frame, capped after ~30 frames; the particle is
// removed once it reaches the center it's drawn to (or this many frames as a safety cap).
const PARTICLE_FRAMES = 34;
const PARTICLE_ALPHA_STEP = 0.03;
const PARTICLE_ALPHA_CAP = 0.9;

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
		this.goldEffects = [];      // [{ key, label, expiry }] — temporary gold-shape buffs.
		this.particles = [];        // [{ x, y, vx, vy, size, dying }] — gold-shape sparkle bits.
		this.walls = [];            // [{ x, y, size }] — debug map-editor walls (session-only).
		this.lightningBolts = [];   // [{ points: [{x,y}, ...], life }] — lightning visuals fading out.
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
		this._lightningFiredThisFrame = false;
		for (let i = this.lightningBolts.length - 1; i >= 0; --i) {
			if (--this.lightningBolts[i].life <= 0) this.lightningBolts.splice(i, 1);
		}
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
		// Prune expired gold effects.
		const now = performance.now();
		if (this.goldEffects.length) this.goldEffects = this.goldEffects.filter((e) => e.expiry > now);
		// Gold-shape particles: spawned on a ring, drift toward the shape's center, fade in,
		// then snap off — the OSA portal-particle effect (ring of bits being drawn inward).
		for (let i = this.particles.length - 1; i >= 0; --i) {
			const p = this.particles[i];
			p.age += 1;
			p.x += p.vx;
			p.y += p.vy;
			const dx = p.cx - p.x, dy = p.cy - p.y;
			if (p.age > PARTICLE_FRAMES || dx * dx + dy * dy < 64) this.particles.splice(i, 1);
		}
	}

	render(drawText) {
		const ctx = this.ctx;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		this.room.render(ctx);

		// Map-editor walls. OSA Class.wall.COLOR = "lgrey" = #a4a4ad in the normal theme;
		// borders are darken(fill, 0.65). Drawn as axis-aligned squares with rounded corners.
		if (this.walls.length) {
			const sc = this.scale * this.room.fov;
			ctx.fillStyle = "#a4a4ad";
			ctx.strokeStyle = darken("#a4a4ad", 0.65);
			ctx.lineWidth = 4 * sc;
			ctx.lineJoin = "round";
			ctx.lineCap = "round";
			for (const w of this.walls) {
				const half = w.size / 2;
				const x = (w.x - half) * sc;
				const y = (w.y - half) * sc;
				const side = w.size * sc;
				// Sharp 4-vertex path; the round line-join on the stroke softens corners just
				// like tank barrels (which are also sharp polygons stroked with lineJoin=round).
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x + side, y);
				ctx.lineTo(x + side, y + side);
				ctx.lineTo(x, y + side);
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
			}
		}

		for (const siege of this.sieges) siege.render(ctx);
		for (const shape of this.shapes) shape.render(ctx);
		for (const tank of this.tanks) tank.render(ctx);

		if (this.lightningBolts.length) {
			const sc = this.scale * this.room.fov;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (const b of this.lightningBolts) {
				const alpha = Math.min(1, b.life / b.maxLife);
				ctx.globalAlpha = alpha;
				ctx.strokeStyle = "rgba(180,210,255,0.85)";
				ctx.lineWidth = 9 * sc;
				ctx.beginPath();
				ctx.moveTo(b.points[0].x * sc, b.points[0].y * sc);
				for (let i = 1; i < b.points.length; i++) ctx.lineTo(b.points[i].x * sc, b.points[i].y * sc);
				ctx.stroke();
				ctx.strokeStyle = "#ffffff";
				ctx.lineWidth = 3 * sc;
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}

		// Gold-shape sparkle particles (gold = the square color).
		if (this.particles.length) {
			const sc = this.scale * this.room.fov;
			ctx.fillStyle = colors.square;
			ctx.strokeStyle = darken(colors.square);
			ctx.lineWidth = 4 * sc;   // same border width as a bullet.
			for (const p of this.particles) {
				ctx.globalAlpha = Math.min(PARTICLE_ALPHA_CAP, PARTICLE_ALPHA_STEP * p.age);
				ctx.beginPath();
				ctx.arc(p.x * sc, p.y * sc, p.size * sc, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}

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
		// Reorderable tabs (currently just the Tank tab) display their upgrades in
		// the order described by state.tankFilterOrder, padded with any new indices
		// so adding a new filter to tankUpgrades doesn't drop it from the panel.
		const baseUpgrades = this.currentTab.upgrades;
		let displayUpgrades = baseUpgrades;
		if (this.currentTab.reorderable) {
			const order = (state.tankFilterOrder || []).filter((i) => i >= 0 && i < baseUpgrades.length);
			for (let k = 0; k < baseUpgrades.length; k++) if (!order.includes(k)) order.push(k);
			state.tankFilterOrder = order;
			displayUpgrades = order.map((i) => baseUpgrades[i]);
		}
		const totalContentH = displayUpgrades.length * upgradeSpacing;
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
		const reorder = !!this.currentTab.reorderable;
		const HANDLE_W = 36 * this.scale;
		const draggingIdx = reorder ? this.draggingFilterIdx ?? null : null;
		// Suppress segment-clicks on sliders while a drag is being resolved this frame so
		// the underlying SliderButton doesn't both reorder and change its value.
		const dragRelease = draggingIdx !== null && !mouse.left;
		for (let i = 0; i < displayUpgrades.length; ++i) {
			const upgrade = displayUpgrades[i];
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

			// Briefly mute leftRelease for slider/button callbacks if a reorder drop is
			// happening this frame, so the dragged slot doesn't also fire its slider value.
			const savedRelease = mouse.leftRelease;
			if (dragRelease) mouse.leftRelease = false;
			const xForButton = reorder ? x + HANDLE_W : x;
			const wForButton = reorder ? w - HANDLE_W : w;
			upgrade.button.render(ctx, xForButton, y, wForButton, h, "", effectivelyDisabled);
			if (dragRelease) mouse.leftRelease = savedRelease;
			if (willFire && desired > 1 && !dragRelease) {
				for (let k = 1; k < desired; k++) {
					if (upgrade.isDisabled()) break;
					upgrade.button.callback();
				}
			}
			drawText(ctx, upgrade.getLabel(), xForButton + 8 * this.scale, y + 8 * this.scale, false, true, false, 32 * this.scale);
			drawText(ctx, secondary, xForButton + 8 * this.scale, y + 52 * this.scale, false, true, false, 24 * this.scale);

			// Drag handle: 3-line "≡" glyph on the left, picks up the row when clicked.
			if (reorder) {
				const hx = x + 2 * this.scale;
				const hw = HANDLE_W - 4 * this.scale;
				const handleHovered = mouse.x >= x && mouse.x <= x + HANDLE_W && mouse.y >= y && mouse.y <= y + h;
				ctx.fillStyle = handleHovered ? "#555" : "#3a3a3a";
				ctx.fillRect(hx, y, hw, h);
				ctx.fillStyle = "#bbb";
				const lineW = hw * 0.7;
				const lineH = 4 * this.scale;
				const lineX = hx + (hw - lineW) / 2;
				ctx.fillRect(lineX, y + h / 2 - 14 * this.scale, lineW, lineH);
				ctx.fillRect(lineX, y + h / 2 - 2 * this.scale, lineW, lineH);
				ctx.fillRect(lineX, y + h / 2 + 10 * this.scale, lineW, lineH);
				if (handleHovered && mouse.leftClick && this.draggingFilterIdx == null) {
					this.draggingFilterIdx = i;
					this.dragFilterPointerY = mouse.y;
					mouse.leftClick = false;
				}
			}
		}
		ctx.restore();

		// Reorder-drop: when a drag is released, work out the target index from the
		// pointer's y and rewrite state.tankFilterOrder.
		if (reorder && this.draggingFilterIdx != null) {
			if (mouse.left) {
				// Render a faint highlight at the would-be drop slot.
				const target = Math.max(0, Math.min(displayUpgrades.length - 1,
					Math.floor((mouse.y - regionTop + this.upgradeScroll) / upgradeSpacing)));
				const ty = regionTop + target * upgradeSpacing - this.upgradeScroll;
				if (ty + 80 * this.scale >= regionTop && ty <= regionBottom) {
					ctx.fillStyle = "rgba(255,255,255,0.18)";
					ctx.fillRect(regionX, ty, regionW, 80 * this.scale);
				}
			} else {
				const target = Math.max(0, Math.min(displayUpgrades.length - 1,
					Math.floor((mouse.y - regionTop + this.upgradeScroll) / upgradeSpacing)));
				const order = state.tankFilterOrder.slice();
				const [moved] = order.splice(this.draggingFilterIdx, 1);
				order.splice(target, 0, moved);
				state.tankFilterOrder = order;
				this.draggingFilterIdx = null;
				mouse.leftRelease = false;
			}
		}

		// Active gold-shape effects, shown as small gold text above the score indicator.
		// Multiple stacks of the same key collapse to one line showing the combined
		// multiplier and the soonest-expiring stack's countdown (so the player sees
		// when the multiplier will next drop).
		if (this.goldEffects.length) {
			const now = performance.now();
			const byKey = new Map();
			for (const e of this.goldEffects) {
				if (e.expiry <= now) continue;
				const cur = byKey.get(e.key);
				if (!cur) byKey.set(e.key, { label: e.label, mul: e.mul, earliest: e.expiry });
				else { cur.mul *= e.mul; cur.earliest = Math.min(cur.earliest, e.expiry); }
			}
			if (byKey.size > 0) {
				const parts = [];
				for (const v of byKey.values()) {
					const rem = (v.earliest - now) / 1000;
					const m = Math.floor(rem / 60);
					const s = Math.floor(rem % 60);
					const mulStr = Number.isInteger(v.mul) ? String(v.mul) : v.mul.toFixed(2).replace(/\.?0+$/, "");
					parts.push(mulStr + "x " + v.label + " (" + m + ":" + String(s).padStart(2, "0") + ")");
				}
				ctx.font = "bold " + 20 * this.scale + "px Ubuntu";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.lineWidth = 5 * this.scale;
				ctx.strokeStyle = "#222";
				ctx.fillStyle = colors.square;
				const txt = parts.join(", ");
				ctx.strokeText(txt, this.width / 2, 74 * this.scale);
				ctx.fillText(txt, this.width / 2, 74 * this.scale);
			}
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
