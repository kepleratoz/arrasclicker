import { state } from "./state.js";
import { Vec2, darken, colors, formatNumber, REGEN_PER_FRAME, lerpColor } from "./utils.js";
import { mouse } from "./input.js";
import { drawPolygon, drawHealthBar } from "./render.js";
import { game } from "./game.js";
import { Bullet, tankCanTarget, pushOutOfWalls } from "./tank.js";
import { grantGoldEffect, goldRareChanceMul, goldClickDamageMul, goldClickScoreMul, goldScoreMul } from "./goldEffects.js";

// Gold-shape constants.
const GOLD_CHANCE = 1 / 700;       // fixed: 1 in 700 spawned shapes is gold.
const GOLD_DECAY_MS = 60000;       // gold shapes decay 1 minute after spawning.
const GOLD_HEALTH_MUL = 5;         // gold shapes have 5× base health.
// Eligible gold types — Egg always, the rest gated on being unlocked. Square (1) has no effect.
function eligibleGoldTypes() {
	const out = [0];
	if (state.squaresUnlocked) out.push(1);
	if (state.trianglesUnlocked) out.push(2);
	if (state.pentagonsUnlocked) out.push(3);
	if (state.hexagonsUnlocked) out.push(4);
	return out;
}

const LOG5 = Math.log(5);
const DEATH_FRAMES = 18; // ~300ms at 60fps

export function shapeTypeFromBuff(buff) {
	return Math.log(5 + buff) / LOG5;
}
export function shapeRarityFromBuff(buff) {
	return 1 + buff;
}

export const TYPE_NAMES = ["Egg", "Square", "Triangle", "Pentagon", "Hexagon", "Heptagon", "Octagon", "Nonagon"];
const TYPE_COLORS = [colors.egg, colors.square, colors.triangle, colors.pentagon, colors.hexagon, colors.heptagon, colors.octagon, colors.nonagon];
const RARITY_COLORS = [colors.shiny, colors.legendary, colors.shadow, colors.ultra, "#7ad3db20"];
const ETHEREAL = 4;
const ETHEREAL_VISIBLE_DIST = 100;
const TYPE_SIZES = [5, 20, 20, 26, 28, 56, 112, 224];
const TYPE_SIDES = [0, 4, 3, 5, 6, 7, 8, 9];
const TYPE_BASE_SCORES = [1, 200, 40000, 8e6, 32e8, 32e10, 64e12, 128e14];
// OSA polygon HP, derived from server/lib/definitions/groups/food.js and constants.js
// (basePolygonHealth = 2). Egg=0.5×base, Square=1×, Triangle=3×, Pentagon=10×, Hexagon=20×.
// Larger polygons extrapolated. Multiplied by per-rarity HP factor below.
const TYPE_BASE_HEALTH = [1, 2, 6, 20, 40, 80, 160, 320];
// OSA polygon DAMAGE (food.js × basePolygonDamage = 1). Egg=0, Square=1, Triangle=1,
// Pentagon=1.5, Hexagon=3. Larger polygons extrapolated.
const TYPE_BASE_DAMAGE = [0, 1, 1, 1.5, 3, 4, 5, 6];

export function makeShapeData(type, rarity, layers) {
	const color = rarity >= 0 ? RARITY_COLORS[rarity] : TYPE_COLORS[type];
	const rarityScoreMul = rarity === ETHEREAL ? 35 * Math.pow(10, 3) : Math.pow(10, Math.max(0, rarity + 1));
	return {
		type,
		rarity,
		size: TYPE_SIZES[type],
		sides: TYPE_SIDES[type],
		color,
		score: TYPE_BASE_SCORES[type] * Math.pow(5, layers) * rarityScoreMul,
	};
}

// Public so the bullet/click death paths can also report kills (Sentry click in
// this file calls it via the in-class startDying chain).
export function recordGalleryKill(type, tier, rarity) {
	if (!state.galleryKills) state.galleryKills = {};
	const r = rarity ?? -1;
	const k = state.galleryKills;
	if (!k[type]) k[type] = {};
	if (!k[type][tier]) k[type][tier] = {};
	k[type][tier][r] = (k[type][tier][r] || 0) + 1;
}

export function randomShapeType(typeRoll, rarityRoll, layers) {
	let type = Math.min(4, shapeTypeFromBuff(typeRoll) | 0) - 1;
	if (type === 3 && state.pentagonsUnlocked && Math.random() < 1 / 6) type = 4;
	// Gold "6x Rare Chance" effect makes a high roll more likely, but never raises the
	// achievable ceiling — clamp the boosted roll to what shapeRarityBuff alone could reach.
	const boostedRoll = Math.min(rarityRoll * goldRareChanceMul(), state.shapeRarityBuff);
	let rarity = Math.min(state.rarityCap, Math.floor(shapeRarityFromBuff(boostedRoll)) - 2);
	if (rarity === 1 && state.rarityCap >= 2 && Math.random() < 1 / 6) rarity = 2;
	if (rarity === 2 && state.rarityCap >= 3 && Math.random() < 1 / 6) rarity = 3;   // shadow → rainbow.
	if (rarity >= 2 && Math.random() < 1 / 25) rarity = ETHEREAL;
	return makeShapeData(type, rarity, layers);
}

export class Shape {
	constructor(pos) {
		this.pos = pos;
		this.angle = Math.random() * Math.PI * 2;
		this.velocity = new Vec2();
		this.fillStyle = "#000";
		this.strokeStyle = "#000";
		this.sides = 0;
		this.size = 10;
		this.drawSize = 1;
		this.layers = 1;
		this.score = 0;
		this.evoTime = 0;
		this.type = 0;
		this.rarity = -1;
		this.health = 1;
		this.dying = 0;
		this.damageType = 1;     // OSA "food" tag: tank bullets with buffVsFood get ×3 damage.
		this.damageBlend = 0;    // OSA-style red-flash on damage; decays per frame.
		this.isGold = false;
		this.isGem = false;      // Gem shapes are debug-spawned via Edition Mode (key 8).
		this.spawnTime = 0;      // performance.now() at spawn; gold shapes decay after GOLD_DECAY_MS.
		this._particleTimer = 0;
		// Up to `state.poisonLevel` concurrent poison stacks. Each entry is
		// { endTime, dps } — the per-frame damage applied is the sum of all
		// not-yet-expired entries' dps / 60.
		this.poisons = [];
	}
	startDying() {
		if (this.dying) return;
		this.dying = state.shapeDeathAnimEnabled ? 1 : DEATH_FRAMES + 1;
		// Tally the kill for the Gallery (skip gold shapes — they're a separate
		// drop class. Sentries / Spawners override startDying entirely.).
		if (!this.isGold) recordGalleryKill(this.type, this.layers, this.rarity);
	}
	static random() {
		const shape = new Shape(
			new Vec2(
				game.room.minX + Math.random() * game.room.maxX,
				game.room.minY + Math.random() * game.room.maxY,
			),
		);
		shape.layers = 1;
		if (Math.random() < GOLD_CHANCE) {
			const types = eligibleGoldTypes();
			shape.makeGold(types[Math.floor(Math.random() * types.length)]);
		} else {
			shape.setType(
				randomShapeType(
					Math.pow(Math.random(), 2) * state.shapeTypeBuff,
					Math.pow(Math.random(), 5) * state.shapeRarityBuff,
					shape.layers,
				),
			);
			shape.setEvoTime();
		}
		return shape;
	}
	// Convert this shape into a "gem": faceted multi-shade body, slightly
	// translucent. Non-spawnable naturally — only the Edition Mode debug
	// action triggers this. Stats stay the same; only the rendering changes.
	makeGem() {
		this.isGem = true;
		this.isGold = false;
	}
	makeGold(type) {
		// Build a common, single-layer shape of the gold type, then re-skin it and
		// give it 5× health. Gold shapes never evolve.
		this.layers = 1;
		this.setType(makeShapeData(type, -1, 1));
		this.fillStyle = colors.square;
		this.strokeStyle = darken(colors.square);
		this.maxHealth *= GOLD_HEALTH_MUL;
		this.health = this.maxHealth;
		this.isGold = true;
		this.spawnTime = performance.now();
		this.evoTime = Infinity;   // belt-and-suspenders: never evolves.
		this._auraPhase = Math.random() * Math.PI * 2;   // de-syncs the pulsing aura between gold shapes.
	}
	setType(data) {
		this.fillStyle = data.color;
		this.strokeStyle = darken(data.color);
		this.sides = data.sides;
		this.size = data.size;
		this.score = data.score;
		this.type = data.type;
		this.rarity = data.rarity ?? -1;
		const rarityHealth = this.rarity === ETHEREAL ? 3
			: this.rarity === 3 ? 8
			: this.rarity === 2 ? 6
			: this.rarity === 1 ? 4
			: this.rarity === 0 ? 2
			: 1;
		this.maxHealth = TYPE_BASE_HEALTH[this.type] * rarityHealth;
		this.health = this.maxHealth;
		this.damage = TYPE_BASE_DAMAGE[this.type];   // OSA-style body damage; consumed by Bullet collisions.
		this.penetration = 1;                        // baseline pen for shapes (no upgrade track).
		this.resist = 0;                             // shapes have RESIST = 0 and brst is small enough that resist clamps to 0.
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		const triangleAdjust = this.sides === 3 && this.layers > 1 ? 2 / (2 + (this.layers - 1)) : 1;
		this.size /= Math.pow(cosFactor, this.layers - 1);
		this.size *= triangleAdjust;
	}
	evolve() {
		if (this.isGold) return;   // gold shapes can't evolve.
		this.layers += 1;
		this.score *= 5;
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		this.size = TYPE_SIZES[this.type];
		const triangleAdjust = this.sides === 3 && this.layers > 1 ? 2 / (2 + (this.layers - 1)) : 1;
		this.size /= Math.pow(cosFactor, this.layers - 1);
		this.size *= triangleAdjust;
		this.setEvoTime();
	}
	setEvoTime() {
		this.evoTime =
			performance.now() +
			(this.layers * (1 + this.type) * 1e4 * (0.5 + Math.random())) / state.shapeEvoNerf[this.type];
	}
	update() {
		if (this.dying) {
			this.dying += 1;
			this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
			const edgeForce = game.room.applyForce(this.pos, this.size, 0.001);
			this.velocity.add(edgeForce);
			this.angle += (0.1 + this.velocity.length()) / 150;
			this.pos.add(this.velocity);
			this.velocity.mulVal(0.98);
			return;
		}
		if (this.isGold) {
			// Gold shapes decay 1 minute after spawning, and shoot off small gold sparkle bits.
			if (performance.now() - this.spawnTime > GOLD_DECAY_MS) { this.startDying(); return; }
			if (--this._particleTimer <= 0) {
				this._particleTimer = 5;
				// Spawn on a ring around the shape and drift inward toward its center, just
				// like a portal's particles being pulled in. The ring scales with the shape;
				// the speed is tuned so the particle reaches the center near the end of its
				// fade-in (≈26 frames travel) — it's brightest right before it vanishes.
				const a = Math.random() * Math.PI * 2;
				const ringR = this.size * 3 + 18;
				const sp = ringR / 26;
				game.particles.push({
					x: this.pos.x + Math.cos(a) * ringR,
					y: this.pos.y + Math.sin(a) * ringR,
					vx: -Math.cos(a) * sp,
					vy: -Math.sin(a) * sp,
					cx: this.pos.x,
					cy: this.pos.y,
					// Same radius as a fully-sized Basic bullet: TANK_SIZE(12) × maxLevelMul(2) × gunWidth(0.8) / 2 = 9.6.
					size: 9.6,
					age: 0,                          // fades IN (OSA portal-particle behavior).
				});
			}
		}
		if (this.layers < state.layersCaps[this.type] && performance.now() > this.evoTime) this.evolve();
		if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + REGEN_PER_FRAME);
		this.damageBlend *= 0.85;
		if (this.damageBlend < 0.01) this.damageBlend = 0;
		this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
		if (this.poisons && this.poisons.length > 0 && !this.dying) {
			const now = performance.now();
			let totalDps = 0;
			for (let i = this.poisons.length - 1; i >= 0; --i) {
				if (this.poisons[i].endTime <= now) this.poisons.splice(i, 1);
				else totalDps += this.poisons[i].dps;
			}
			if (totalDps > 0) this._applyHit(totalDps / 60);
		}
		if ((mouse.leftClick || mouse.right) && !game.debugMode && !game.controlledTank) {
			const screenScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * screenScale;
			const dy = mouse.y - this.pos.y * screenScale;
			const overlap = (mouse.leftClick ? 10 : 100) + this.size * screenScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				if (mouse.leftClick) {
					const baseDmg = (1 + (state.clickDamageUpgrades || 0)) * goldClickDamageMul();
					const equipped = state.equippedClickUpgrade;
					// Midas Touch: 0.1% per level (max 0.4% at level 4). Converts the shape
				// into a RANDOM eligible gold-type, not the shape's own type.
				const midasChance = 0.001 * (state.midasLevel || 0);
				if (equipped === "midas" && midasChance > 0 && Math.random() < midasChance) {
					const types = eligibleGoldTypes();
					this.makeGold(types[Math.floor(Math.random() * types.length)]);
				}
					this._applyHit(baseDmg);
					if (equipped === "poison" && !this.dying) {
						const maxStacks = state.poisonLevel || 1;
						if (!this.poisons) this.poisons = [];
						const newPoison = { endTime: performance.now() + 10000, dps: baseDmg * 0.25 };
						if (this.poisons.length >= maxStacks) this.poisons.shift();   // bump oldest stack.
						this.poisons.push(newPoison);
					}
					if (equipped === "lightning" && !game._lightningFiredThisFrame) {
						game._lightningFiredThisFrame = true;
						state.lightningClickCount = (state.lightningClickCount || 0) + 1;
						if (state.lightningClickCount % 3 === 0) this._fireLightning(baseDmg);
					}
				} else {
					const angle = Math.atan2(dy, dx);
					const push = Vec2.circle(angle, overlap / 100);
					this.velocity.sub(push);
				}
			}
		}
		const edgeForce = game.room.applyForce(this.pos, this.size, 0.001);
		this.velocity.add(edgeForce);
		this.velocity.add(Vec2.circle(this.angle + 1, 1 / 30 / Math.sqrt(this.size)));
		this.evoTime -= this.velocity.length() * 10;
		this.angle += (0.1 + this.velocity.length()) / 150;
		this.pos.add(this.velocity);
		pushOutOfWalls(this.pos, this.size);
		this.velocity.mulVal(0.98);
	}
	render(ctx) {
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		const fade = this.dying ? Math.max(0, 1 - this.dying / DEATH_FRAMES) : 1;
		const sizeMul = 1 + 0.5 * (1 - fade);
		let colorScale = this.dying ? 1 : Math.max(0.35, this.health / this.maxHealth);
		if (this.isGold && !this.dying) {
			// Gold shapes darken as they age. The age-darkness and damage-darkness don't
			// stack — render whichever is darker (the lower colorScale).
			const ageT = Math.min(1, (performance.now() - this.spawnTime) / GOLD_DECAY_MS);
			const ageScale = Math.max(0.35, 1 - 0.6 * ageT);
			colorScale = Math.min(colorScale, ageScale);
		}
		let visibilityAlpha = 1;
		if (this.rarity === ETHEREAL && !this.dying) {
			const sc = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * sc;
			const dy = mouse.y - this.pos.y * sc;
			const d = Math.sqrt(dx * dx + dy * dy);
			visibilityAlpha = Math.max(0, 1 - d / (ETHEREAL_VISIBLE_DIST * game.scale));
		}
		ctx.globalAlpha = fade * visibilityAlpha;
		if (ctx.globalAlpha <= 0) { ctx.globalAlpha = 1; return; }
		if (this.isGem) { this._renderGem(ctx, sizeMul, fade); ctx.globalAlpha = 1; return; }
		// Pulsing translucent aura behind gold shapes — the OSA portal-ring effect.
		// OSA portalAura: ALPHA 0.4, SIZE oscillates 32↔45 by 1.2/tick on a SIZE-25 portal
		// (≈1.28×→1.8× the source radius, ≈1.4 Hz). Drawn first so the shape sits on top.
		if (this.isGold && !this.dying) {
			const sc = game.scale * game.room.fov;
			const baseR = this.drawSize * sizeMul * sc;
			const auraR = baseR * (1.54 + 0.26 * Math.sin(Date.now() * 0.009 + this._auraPhase));
			ctx.globalAlpha = 0.4 * fade;
			ctx.fillStyle = darken(colors.square, colorScale);
			ctx.strokeStyle = darken(darken(colors.square), colorScale);
			ctx.lineWidth = 3 * sc;
			ctx.beginPath();
			ctx.arc(this.pos.x * sc, this.pos.y * sc, auraR, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.globalAlpha = fade * visibilityAlpha;
		}
		if (this.rarity === 3) {
			const hue = (Date.now() * 0.1) % 360;   // halved cycle speed.
			const fillL = Math.round(60 * colorScale);
			const strokeL = Math.round(35 * colorScale);
			ctx.fillStyle = `hsl(${hue}, 80%, ${fillL}%)`;
			ctx.strokeStyle = `hsl(${hue}, 60%, ${strokeL}%)`;
		} else {
			ctx.fillStyle = darken(this.fillStyle, colorScale);
			ctx.strokeStyle = darken(this.strokeStyle, colorScale);
		}
		// OSA-style red hit-flash on damage. Skip for rainbow shapes (hsl() colors don't parse).
		const blend = state.damageBlendEnabled ? (this.damageBlend ?? 0) * 0.5 : 0;
		if (blend > 0 && this.rarity !== 3) {
			ctx.fillStyle = lerpColor(ctx.fillStyle, "#ff5050", blend);
			ctx.strokeStyle = lerpColor(ctx.strokeStyle, "#7a1a1a", blend);
		}
		ctx.lineWidth = 3 * game.scale * game.room.fov;
		for (let i = 0; i < this.layers; ++i) {
			drawPolygon(
				ctx,
				this.pos.x,
				this.pos.y,
				this.drawSize * sizeMul * Math.pow(cosFactor, i),
				this.angle + (i & 1 ? 0 : Math.PI / sides),
				this.sides,
			);
			ctx.fill();
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}
	collide(other) {
		const dx = other.pos.x - this.pos.x;
		const dy = other.pos.y - this.pos.y;
		const overlap = this.size + other.size - Math.sqrt(dx * dx + dy * dy);
		if (overlap < 0) return;
		const angle = Math.atan2(dy, dx);
		this.pos.sub(Vec2.circle(angle, overlap).divideVal(this.size));
		other.pos.add(Vec2.circle(angle, overlap).divideVal(other.size));
	}
	_applyHit(damage) {
		if (this.dying) return;
		this.health -= damage;
		this.damageBlend = 1;
		if (this.rarity === ETHEREAL && this.health > 0 && Math.random() < 0.5) {
			this.pos.x = game.room.minX + Math.random() * game.room.maxX;
			this.pos.y = game.room.minY + Math.random() * game.room.maxY;
		}
		if (this.health <= 0) {
			if (this.isGold) grantGoldEffect(this.type);
			this.startDying();
			const gained = Math.round(this.score * goldScoreMul() * goldClickScoreMul());
			state.score += gained;
			const sc = game.scale * game.room.fov;
			game.flyingText.push({
				x: this.pos.x * sc,
				y: this.pos.y * sc,
				alpha: 1,
				text: "+" + formatNumber(gained),
			});
		}
	}
	// Render a gem version of this shape: each face (triangle from center to
	// an edge) is shaded based on a notional light from above, the whole body
	// is drawn translucent, and inner ridge lines from center → vertices give
	// a faceted crystal look.
	_renderGem(ctx, sizeMul, fade) {
		const sides = Math.max(3, this.sides);
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const baseR = this.drawSize * sizeMul * sc;
		const cosFactor = Math.cos(Math.PI / sides);
		const base = this.fillStyle;
		const stroke = this.strokeStyle;
		for (let layer = 0; layer < this.layers; ++layer) {
			const r = baseR * Math.pow(cosFactor, layer);
			const layerAngle = this.angle + ((layer & 1) ? 0 : Math.PI / sides);
			// Per-face triangles, brighter on top / darker on bottom.
			for (let i = 0; i < sides; ++i) {
				const a1 = layerAngle + (i / sides) * Math.PI * 2;
				const a2 = layerAngle + ((i + 1) / sides) * Math.PI * 2;
				const faceAngle = (a1 + a2) / 2;
				const shade = Math.max(0.2, Math.min(1, 0.5 - 0.4 * Math.sin(faceAngle)));
				ctx.globalAlpha = 0.7 * fade;
				ctx.fillStyle = darken(base, shade);
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
				ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
				ctx.closePath();
				ctx.fill();
			}
			// Outer outline (thicker, darker).
			ctx.globalAlpha = 0.9 * fade;
			ctx.strokeStyle = stroke;
			ctx.lineWidth = 3 * sc;
			ctx.lineJoin = "round";
			ctx.beginPath();
			for (let i = 0; i < sides; ++i) {
				const a = layerAngle + (i / sides) * Math.PI * 2;
				const x = cx + Math.cos(a) * r;
				const y = cy + Math.sin(a) * r;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.stroke();
			// Faint inner ridge lines from center to each vertex — the facet edges.
			ctx.globalAlpha = 0.35 * fade;
			ctx.lineWidth = 1.5 * sc;
			ctx.beginPath();
			for (let i = 0; i < sides; ++i) {
				const a = layerAngle + (i / sides) * Math.PI * 2;
				ctx.moveTo(cx, cy);
				ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
			}
			ctx.stroke();
		}
	}
	_fireLightning(damage) {
		const MAX_CHAIN = 6;
		const MAX_HOP_SQ = 250 * 250;
		const visited = new Set([this]);
		const points = [{ x: this.pos.x, y: this.pos.y }];
		let current = this;
		for (let i = 0; i < MAX_CHAIN; i++) {
			let best = null;
			let bestSq = MAX_HOP_SQ;
			for (const s of game.shapes) {
				if (visited.has(s) || s.dying) continue;
				if (!(tankCanTarget(s) || s.type === this.type)) continue;
				const dx = s.pos.x - current.pos.x;
				const dy = s.pos.y - current.pos.y;
				const d = dx * dx + dy * dy;
				if (d < bestSq) { bestSq = d; best = s; }
			}
			if (!best) break;
			visited.add(best);
			points.push({ x: best.pos.x, y: best.pos.y });
			best._applyHit(damage);
			current = best;
		}
		if (points.length >= 2) game.lightningBolts.push({ points, life: 18, maxLife: 18 });
	}
	isDead() {
		return this.dying > 0;
	}
	isFullyDead() {
		return this.dying > DEATH_FRAMES;
	}
}

// ---------- Sentry ----------
// A large enemy triangle (~Beta Triangle size) with a single auto-cannon turret that
// targets and shoots tanks. Stats are baked at MAX (max upgrade levels for everything
// except shield, which is zero), 100 HP, no shield, no shield regen.
// OSA Class.sentry: SIZE = 10, varies-in-size with level. We use 15 as our base so
// it sits between a basic tank (12) and a max-level tank (24), then scale up with
// level via the same `1 + level/42` curve tanks use.
const SENTRY_BASE_SIZE = 20;
const SENTRY_SPAWN_LEVEL = 30;
const SENTRY_SIZE = SENTRY_BASE_SIZE * (1 + Math.min(42, SENTRY_SPAWN_LEVEL) / 42);
const SENTRY_FILL = "#ef99c3";       // OSA "pink".
const SENTRY_HEALTH = 100;
const SENTRY_RANGE = 1000;
const SENTRY_TURN_RATE = 0.08;
// OSA Class.sentry BODY: { DAMAGE: base.DAMAGE = 3, SPEED: 0.5·base.SPEED, HEALTH: 0.3·base.HEALTH }.
const SENTRY_BODY_DAMAGE = 3;
const SENTRY_MOVE_SPEED = 0.6;       // ≈ 0.5 × our BASE_TANK_SPEED (1.2), mirroring OSA's 0.5·base.SPEED.
const SENTRY_ORBIT_RADIUS = 368;     // world units from the chosen sanctuary's center (+15%).
const SENTRY_RADIAL_CORRECTION = 0.04;  // strength of radial pull-toward-orbit-radius.
const SENTRY_RECOIL_IMPULSE = 0.18;
const SENTRY_RECOIL_SPRING = 0.2;
const SENTRY_RECOIL_DAMP = 0.5;
// MAX-tier upgrade levels for the auto-cannon's bullet stats; shield upgrades stay 0.
const SENTRY_MAX_UPGRADES = {
	hp: 10, reload: 5, damage: 5, bulletHealth: 5, bulletSpeed: 5, speed: 3,
	shieldCap: 0, shieldRegen: 0,
};
const SENTRY_SHOOT_INTERVAL_MS = 600 * Math.pow(0.9, SENTRY_MAX_UPGRADES.reload);
const SENTRY_SHOOT_CFG = {
	targetsTanks: true,
	damage: 2,                       // fixed 2 damage (ignoreUpgradeDamage uses base 1).
	health: 0.4,                     // fixed 2 health (ignoreUpgradeHealth uses base 5).
	ignoreUpgradeDamage: true,
	ignoreUpgradeHealth: true,
};
// OSA sentryGun = makeAuto("sentry", "Sentry", { type: "megaAutoTankGun", size: 12 }).
// Turret SIZE 12 on sentry SIZE 10 → bound.size = 12/20 = 0.6, turret radius = 3
// (sentry size 10 × bound 0.6 ÷ 2). So turret/sentry radius ratio = 0.3.
// megaAutoTankGun's gun POSITION = [22, 14, 1, 0, 0, 0, 0] → length 2.2, width 1.4
// in turret-radii units.
const SENTRY_TURRET_BODY = 0.3;      // turret body radius, in sentry-radii units (OSA-derived).
const SENTRY_BARREL_LEN = 2.2;       // barrel length, in turret-radii units (OSA megaAutoTankGun).
const SENTRY_BARREL_W = 1.4;         // barrel width, in turret-radii units (OSA megaAutoTankGun).
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";

export class Sentry extends Shape {
	constructor(pos, opts = {}) {
		super(pos);
		this.neutral = !!opts.neutral;
		this.size = SENTRY_SIZE;
		this.drawSize = SENTRY_SIZE;
		this.maxHealth = SENTRY_HEALTH;
		this.health = SENTRY_HEALTH;
		this.maxShield = 0;
		this.shield = 0;
		this.fillStyle = this.neutral ? "#feca3f" : SENTRY_FILL;
		this.strokeStyle = darken(this.fillStyle);
		this.sides = 3;
		this.type = 2;          // triangle (for tank targeting compatibility)
		this.rarity = -1;
		this.layers = 1;
		this.score = 0;
		this.upgrades = { ...SENTRY_MAX_UPGRADES };
		this.level = SENTRY_SPAWN_LEVEL;
		this.bullets = [];
		this.turretAngle = 0;
		this.shootTime = 0;
		this.gunState = { gunPosition: 0, gunMotion: 0 };
		this.velocity = new Vec2();
		this.orbitDir = Math.random() < 0.5 ? 1 : -1;   // CW or CCW around the sanctuary.
		this.angle = 0;          // body facing; updated each frame to follow velocity.
		this.isSentry = true;   // marker for Tank distance-keeping logic.
		this.damageType = 0;    // not food — buffVsFood doesn't apply to sentries.
		this.damage = SENTRY_BODY_DAMAGE;  // body damage (when bullets bump into the triangle).
		this.penetration = 2;   // sentries are tougher to chip through than basic shapes.
		// Sentry has all skills maxed; brst = 0.3·(0.5·atk + 0.5·hlt + rgn) ≈ 8.25, so
		// resist = 1 - 1/(0 + 8.25) ≈ 0.879 — heavy damage reduction vs un-upgraded tanks.
		this.resist = 1 - 1 / 8.25;
	}
	startDying() {
		if (this.dying) return;
		// A killed sentry pays out 5% of the player's current score, capped at e18.
		if (!this.neutral) this.score = Math.min(state.score * 0.05, 1e18);
		this.dying = state.shapeDeathAnimEnabled ? 1 : DEATH_FRAMES + 1;
	}
	takeDamage(n) {
		if (this.neutral) return;   // neutral sentries are invulnerable landmarks.
		if (this.isDead()) return;
		this.health = Math.max(0, this.health - n);
		this.damageBlend = 1;
		if (this.health <= 0) this.startDying();
	}
	update() {
		// Neutral sentries are passive: no shooting, no movement, no click damage.
		if (this.neutral) {
			this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
			return;
		}
		if (this.dying) {
			this.dying += 1;
			this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
			for (let i = this.bullets.length - 1; i >= 0; --i) {
				this.bullets[i].update();
				if (this.bullets[i].dead) this.bullets.splice(i, 1);
			}
			return;
		}
		if (this.health < this.maxHealth) {
			this.health = Math.min(this.maxHealth, this.health + REGEN_PER_FRAME);
		}
		this.damageBlend *= 0.85;
		if (this.damageBlend < 0.01) this.damageBlend = 0;
		this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
		// Click damage (left-click on the body), matching Shape behavior.
		if (mouse.leftClick && !game.debugMode && !game.controlledTank) {
			const sScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * sScale;
			const dy = mouse.y - this.pos.y * sScale;
			const overlap = 10 + this.size * sScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				// Sentries take 20% of click damage (they're not pure "click fodder" like shapes).
				this.health -= (1 + (state.clickDamageUpgrades || 0)) * goldClickDamageMul() * 0.2;
				this.damageBlend = 1;
				if (this.health <= 0) {
					this.startDying();   // sets this.score based on current state.score.
					const gained = Math.round(this.score * goldScoreMul() * goldClickScoreMul());
					state.score += gained;
					game.flyingText.push({
						x: this.pos.x * sScale,
						y: this.pos.y * sScale,
						alpha: 1,
						text: "+" + formatNumber(gained),
					});
				}
			}
		}
		// Movement: orbit the nearest sanctuary at SENTRY_ORBIT_RADIUS, picked once per frame.
		// Neutral sanctuaries are passive landmarks — sentries ignore them.
		let homeSanctuary = null;
		let homeDistSq = Infinity;
		for (const sg of game.sieges) {
			if (sg.neutral) continue;
			const dx = sg.pos.x - this.pos.x;
			const dy = sg.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < homeDistSq) { homeDistSq = d; homeSanctuary = sg; }
		}
		if (homeSanctuary) {
			const dx = this.pos.x - homeSanctuary.pos.x;
			const dy = this.pos.y - homeSanctuary.pos.y;
			const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
			const radialError = dist - SENTRY_ORBIT_RADIUS;
			const radX = -dx / dist;            // points toward sanctuary.
			const radY = -dy / dist;
			const tanX = -dy / dist * this.orbitDir;   // tangent (signed by orbit direction).
			const tanY = dx / dist * this.orbitDir;
			this.velocity.x = tanX * SENTRY_MOVE_SPEED + radX * radialError * SENTRY_RADIAL_CORRECTION;
			this.velocity.y = tanY * SENTRY_MOVE_SPEED + radY * radialError * SENTRY_RADIAL_CORRECTION;
			this.pos.add(this.velocity);
			pushOutOfWalls(this.pos, this.size);
			// Body faces the direction it's moving in.
			if (this.velocity.x !== 0 || this.velocity.y !== 0) {
				this.angle = Math.atan2(this.velocity.y, this.velocity.x);
			}
		}
		// Auto-cannon target: nearest live tank in range, falling back to the chosen sanctuary.
		let nearest = null;
		let bestSq = SENTRY_RANGE * SENTRY_RANGE;
		for (const t of game.tanks) {
			if (t.isDead && t.isDead()) continue;
			const dx = t.pos.x - this.pos.x;
			const dy = t.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < bestSq) { bestSq = d; nearest = t; }
		}
		if (!nearest && homeSanctuary) nearest = homeSanctuary;
		if (nearest) {
			const dx = nearest.pos.x - this.pos.x;
			const dy = nearest.pos.y - this.pos.y;
			const target = Math.atan2(dy, dx);
			let delta = target - this.turretAngle;
			while (delta > Math.PI) delta -= Math.PI * 2;
			while (delta < -Math.PI) delta += Math.PI * 2;
			this.turretAngle += Math.max(-SENTRY_TURN_RATE, Math.min(SENTRY_TURN_RATE, delta));
			const now = performance.now();
			if (now > this.shootTime) {
				const cosA = Math.cos(this.turretAngle);
				const sinA = Math.sin(this.turretAngle);
				const tipDist = SENTRY_BARREL_LEN * SENTRY_TURRET_BODY * this.size;
				const tipX = this.pos.x + cosA * tipDist;
				const tipY = this.pos.y + sinA * tipDist;
				this.bullets.push(new Bullet(new Vec2(tipX, tipY), this.turretAngle, this, SENTRY_SHOOT_CFG, SENTRY_BARREL_W * SENTRY_TURRET_BODY, 1));
				this.shootTime = now + SENTRY_SHOOT_INTERVAL_MS;
				this.gunState.gunMotion += SENTRY_RECOIL_IMPULSE;
			}
		}
		this.gunState.gunMotion -= SENTRY_RECOIL_SPRING * this.gunState.gunPosition;
		this.gunState.gunPosition += this.gunState.gunMotion;
		if (this.gunState.gunPosition < 0) { this.gunState.gunPosition = 0; this.gunState.gunMotion = -this.gunState.gunMotion; }
		if (this.gunState.gunMotion > 0) this.gunState.gunMotion *= SENTRY_RECOIL_DAMP;
		for (let i = this.bullets.length - 1; i >= 0; --i) {
			this.bullets[i].update();
			if (this.bullets[i].dead) this.bullets.splice(i, 1);
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const fade = this.dying ? Math.max(0, 1 - this.dying / DEATH_FRAMES) : 1;
		const sizeMul = 1 + 0.5 * (1 - fade);
		// Bullets first (under the body).
		for (const b of this.bullets) b.render(ctx);
		ctx.globalAlpha = fade;
		// Triangle body, with OSA-style red hit-flash if recently damaged.
		const blend = state.damageBlendEnabled ? (this.damageBlend ?? 0) * 0.5 : 0;
		ctx.fillStyle = blend > 0 ? lerpColor(this.fillStyle, "#ff5050", blend) : this.fillStyle;
		ctx.strokeStyle = blend > 0 ? lerpColor(this.strokeStyle, "#7a1a1a", blend) : this.strokeStyle;
		ctx.lineWidth = 4 * sc;
		ctx.lineJoin = "round";
		ctx.beginPath();
		const r = this.drawSize * sizeMul * sc;
		for (let i = 0; i < 3; i++) {
			// Vertex 0 is the "forward" tip; rotates with this.angle so the body points
			// in the direction the sentry is moving.
			const a = this.angle + (i / 3) * Math.PI * 2;
			const x = cx + Math.cos(a) * r;
			const y = cy + Math.sin(a) * r;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		// Auto cannon: barrel + small turret body. Barrel/width are sized relative to the
		// turret-body radius (Basic-tank style), not the whole sentry — keeps proportions sane.
		const turretR = SENTRY_TURRET_BODY * this.size * sc;
		const barrelLen = SENTRY_BARREL_LEN * turretR;
		const barrelHalfW = (SENTRY_BARREL_W / 2) * turretR;
		const recoil = this.gunState.gunPosition * turretR;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.turretAngle);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = 4 * sc;
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo(-recoil, -barrelHalfW);
		ctx.lineTo(barrelLen - recoil, -barrelHalfW);
		ctx.lineTo(barrelLen - recoil, barrelHalfW);
		ctx.lineTo(-recoil, barrelHalfW);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(0, 0, turretR, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
		ctx.globalAlpha = 1;
		if (!this.dying) {
			drawHealthBar(ctx, cx, cy, r, this.health, this.maxHealth, game.scale);
		}
	}
}

// ---------- Sentry Spawner ----------
// A large pink triangle that periodically births a Sentry from a single barrel
// (OSA Enchantress-style spawner). Tracks living children up to a cap so it
// doesn't flood the field.
const SS_SIZE = 140;                // 75% larger than the original 80.
const SS_HEALTH = 1000;
const SS_BODY_DAMAGE = 2;
const SS_REGEN = 0.08;              // per frame (~5 HP/sec at 60fps).
const SS_SPAWN_INTERVAL_MS = 16000; // all three barrels volley together every 16s.
const SS_MAX_CHILDREN = 16;
const SS_SPIN_RATE = 0.004;
const SS_BARRELS = 3;               // one director-style barrel per triangle side.
const SS_BARREL_LEN = 0.22;         // in body-radius units — short Enchantress nub.
const SS_BARREL_INNER_W = 0.75;     // base width, in body-radius units.
const SS_BARREL_OUTER_W = 1.1;      // flared tip — director style.
const SS_BARREL_INSET = 0.12;       // how far the barrel base is recessed inside the body.
const SS_RECOIL_IMPULSE = 0.18;
const SS_RECOIL_SPRING = 0.2;
const SS_RECOIL_DAMP = 0.5;
// Auto-healer turret on top of the Sentry Spawner. Disabled for now; flip
// SS_HEALER_ENABLED back to true to bring it back.
const SS_HEALER_ENABLED = false;
const SS_HEALER_SIZE = 0.22;            // turret body radius in spawner-radius units.
const SS_HEALER_BARREL_LEN = 1.5;       // barrel length in turret-radius units.
const SS_HEALER_BARREL_W = 0.7;         // barrel width in turret-radius units.
const SS_HEALER_TURN_RATE = 0.12;
const SS_HEALER_SHOOT_INTERVAL_MS = 700;
const SS_HEALER_RANGE = 900;
const SS_HEALER_HEAL = 5;
const SS_HEALER_HAT_FILL = "#e4363b";
const SS_HEALER_HAT_STROKE = "#7e3b3d";
const SS_HEAL_BULLET_RADIUS = 9;
const SS_HEAL_BULLET_CFG = {
	sentryHeal: true,
	healAmount: SS_HEALER_HEAL,
	damage: 0,
	health: 2,
	speed: 1.0,
	range: 0.7,
	ignoreUpgradeDamage: true,
	ignoreUpgradeHealth: true,
	ignoreUpgradeSpeed: true,
};
// OSA healerHat polygon (same as siege.js); normalized to ±1.
const SS_HEALER_HAT_SHAPE = [
	[0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3],
	[0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3],
	[-1, -0.3], [-0.3, -0.3], [-0.3, -1], [0.3, -1],
];

export class SentrySpawner extends Shape {
	constructor(pos) {
		super(pos);
		this.size = SS_SIZE;
		this.drawSize = SS_SIZE;
		this.maxHealth = SS_HEALTH;
		this.health = SS_HEALTH;
		this.fillStyle = SENTRY_FILL;
		this.strokeStyle = darken(this.fillStyle);
		this.sides = 3;
		this.type = 2;             // triangle, for any incidental tank-target logic.
		this.rarity = -1;
		this.layers = 1;
		this.score = 0;
		this.isSentrySpawner = true;
		this.damageType = 0;
		this.damage = SS_BODY_DAMAGE;
		this.penetration = 3;
		this.resist = 1 - 1 / 8.25;
		this.angle = Math.random() * Math.PI * 2;
		this.children = [];
		this.spawnTime = 0;
		this.nextBarrelIdx = 0;
		this.barrelStates = Array.from({ length: SS_BARRELS }, () => ({ position: 0, motion: 0 }));
		this.velocity = new Vec2();
		this.orbitDir = Math.random() < 0.5 ? 1 : -1;
		// Auto-healer: spins to face the nearest injured Sentry and shoots pink
		// heal bullets. Idle aim follows the spawner's current movement vector.
		this.healerTurret = {
			angle: 0,
			shootTime: 0,
			gunState: { position: 0, motion: 0 },
		};
		this.bullets = [];
	}
	startDying() {
		if (this.dying) return;
		// A killed spawner pays out 100% of the player's current score, capped at e20.
		this.score = Math.min(state.score, 1e20);
		this.dying = state.shapeDeathAnimEnabled ? 1 : DEATH_FRAMES + 1;
	}
	takeDamage(n) {
		if (this.isDead()) return;
		this.health = Math.max(0, this.health - n);
		this.damageBlend = 1;
		if (this.health <= 0) this.startDying();
	}
	update() {
		if (this.dying) {
			this.dying += 1;
			this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
			return;
		}
		this.angle += SS_SPIN_RATE;
		if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + SS_REGEN);
		// Slow orbit around the nearest (non-neutral) sanctuary, mirroring Sentry's
		// behaviour but at a wider radius and a slower base speed.
		let home = null;
		let homeDistSq = Infinity;
		for (const sg of game.sieges) {
			if (sg.neutral) continue;
			const dx = sg.pos.x - this.pos.x;
			const dy = sg.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < homeDistSq) { homeDistSq = d; home = sg; }
		}
		if (home) {
			const SS_ORBIT_RADIUS = 520;
			const SS_MOVE_SPEED = 0.25;
			const SS_RADIAL_CORRECTION = 0.03;
			const dx = this.pos.x - home.pos.x;
			const dy = this.pos.y - home.pos.y;
			const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
			const radialError = dist - SS_ORBIT_RADIUS;
			const radX = -dx / dist;
			const radY = -dy / dist;
			const tanX = -dy / dist * this.orbitDir;
			const tanY = dx / dist * this.orbitDir;
			this.velocity.x = tanX * SS_MOVE_SPEED + radX * radialError * SS_RADIAL_CORRECTION;
			this.velocity.y = tanY * SS_MOVE_SPEED + radY * radialError * SS_RADIAL_CORRECTION;
			this.pos.add(this.velocity);
			pushOutOfWalls(this.pos, this.size);
		}
		this.damageBlend *= 0.85;
		if (this.damageBlend < 0.01) this.damageBlend = 0;
		this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
		// Drop any children that died this frame OR got removed from the world
		// directly (e.g. via the "Clear Mobs" debug action) — otherwise the
		// spawner gets jammed thinking it's still at max children.
		this.children = this.children.filter((c) => c && !(c.isFullyDead && c.isFullyDead()) && game.shapes.includes(c));
		const now = performance.now();
		if (now > this.spawnTime) {
			// Volley: every barrel that still has capacity fires simultaneously.
			const tipR = this.size * 0.5 + SS_BARREL_LEN * this.size;
			for (let i = 0; i < SS_BARRELS; i++) {
				if (this.children.length >= SS_MAX_CHILDREN) break;
				const dir = this.angle + Math.PI / 3 + i * (Math.PI * 2 / 3);
				const tipX = this.pos.x + Math.cos(dir) * tipR;
				const tipY = this.pos.y + Math.sin(dir) * tipR;
				const child = new Sentry(new Vec2(tipX, tipY));
				child.velocity = Vec2.circle(dir, 3);
				this.children.push(child);
				game.shapes.push(child);
				this.barrelStates[i].motion += SS_RECOIL_IMPULSE;
			}
			this.spawnTime = now + SS_SPAWN_INTERVAL_MS;
		}
		// Recoil spring per barrel.
		for (const gs of this.barrelStates) {
			gs.motion -= SS_RECOIL_SPRING * gs.position;
			gs.position += gs.motion;
			if (gs.position < 0) { gs.position = 0; gs.motion = -gs.motion; }
			if (gs.motion > 0) gs.motion *= SS_RECOIL_DAMP;
		}

		// Auto-healer turret: aim at the nearest injured sentry within range;
		// otherwise track the spawner's motion vector. Fires heal pulses on a
		// fixed interval whenever it has a target.
		if (SS_HEALER_ENABLED) {
		let healTarget = null;
		let bestSq = SS_HEALER_RANGE * SS_HEALER_RANGE;
		for (const sh of game.shapes) {
			if (!sh.isSentry || (sh.isDead && sh.isDead())) continue;
			if (sh.health >= sh.maxHealth) continue;
			const dx = sh.pos.x - this.pos.x;
			const dy = sh.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < bestSq) { bestSq = d; healTarget = sh; }
		}
		let aimAngle = this.healerTurret.angle;
		if (healTarget) {
			aimAngle = Math.atan2(healTarget.pos.y - this.pos.y, healTarget.pos.x - this.pos.x);
		} else if (Math.hypot(this.velocity.x, this.velocity.y) > 0.05) {
			aimAngle = Math.atan2(this.velocity.y, this.velocity.x);
		}
		let dA = aimAngle - this.healerTurret.angle;
		while (dA > Math.PI) dA -= Math.PI * 2;
		while (dA < -Math.PI) dA += Math.PI * 2;
		this.healerTurret.angle += Math.max(-SS_HEALER_TURN_RATE, Math.min(SS_HEALER_TURN_RATE, dA));
		if (healTarget && now > this.healerTurret.shootTime) {
			const turretR = SS_HEALER_SIZE * this.size;
			const barrelLen = SS_HEALER_BARREL_LEN * turretR;
			const tipX = this.pos.x + Math.cos(this.healerTurret.angle) * barrelLen;
			const tipY = this.pos.y + Math.sin(this.healerTurret.angle) * barrelLen;
			this.bullets.push(new Bullet(
				new Vec2(tipX, tipY), this.healerTurret.angle,
				this, SS_HEAL_BULLET_CFG,
				SS_HEALER_BARREL_W * SS_HEALER_SIZE, 1, SS_HEAL_BULLET_RADIUS,
			));
			this.healerTurret.shootTime = now + SS_HEALER_SHOOT_INTERVAL_MS;
			this.healerTurret.gunState.motion += SS_RECOIL_IMPULSE;
		}
		const hgs = this.healerTurret.gunState;
		hgs.motion -= SS_RECOIL_SPRING * hgs.position;
		hgs.position += hgs.motion;
		if (hgs.position < 0) { hgs.position = 0; hgs.motion = -hgs.motion; }
		if (hgs.motion > 0) hgs.motion *= SS_RECOIL_DAMP;
		for (let i = this.bullets.length - 1; i >= 0; --i) {
			this.bullets[i].update();
			if (this.bullets[i].dead) this.bullets.splice(i, 1);
		}
		}   // end SS_HEALER_ENABLED
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const fade = this.dying ? Math.max(0, 1 - this.dying / DEATH_FRAMES) : 1;
		const sizeMul = 1 + 0.5 * (1 - fade);
		const r = this.drawSize * sizeMul * sc;
		const lw = 4 * sc;
		ctx.globalAlpha = fade;
		// Director-style barrels: trapezoid that widens at the tip, one mounted on
		// each side of the triangle. Drawn under the body so the body covers the
		// inset base of each barrel.
		const sideMid = r * 0.5;                   // apothem of equilateral triangle.
		const barrelLen = SS_BARREL_LEN * r;
		const innerHW = (SS_BARREL_INNER_W / 2) * r;
		const outerHW = (SS_BARREL_OUTER_W / 2) * r;
		const inset = SS_BARREL_INSET * r;
		ctx.fillStyle = "#b1b3bc";
		ctx.strokeStyle = "#646568";
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		for (let i = 0; i < SS_BARRELS; i++) {
			const dir = this.angle + Math.PI / 3 + i * (Math.PI * 2 / 3);
			const recoil = this.barrelStates[i].position * r;
			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate(dir);
			ctx.beginPath();
			const baseX = sideMid - inset - recoil;
			const tipX = sideMid + barrelLen - recoil;
			ctx.moveTo(baseX, -innerHW);
			ctx.lineTo(tipX, -outerHW);
			ctx.lineTo(tipX, outerHW);
			ctx.lineTo(baseX, innerHW);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
		// Triangle body with red flash on damage.
		const blend = state.damageBlendEnabled ? this.damageBlend * 0.5 : 0;
		ctx.fillStyle = blend > 0 ? lerpColor(this.fillStyle, "#ff5050", blend) : this.fillStyle;
		ctx.strokeStyle = blend > 0 ? lerpColor(this.strokeStyle, "#7a1a1a", blend) : this.strokeStyle;
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (let i = 0; i < 3; i++) {
			const a = this.angle + (i / 3) * Math.PI * 2;
			const x = cx + Math.cos(a) * r;
			const y = cy + Math.sin(a) * r;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		if (SS_HEALER_ENABLED) {
		// Heal-bullets render under the turret so the turret stays on top.
		for (const b of this.bullets) b.render(ctx);

		// Auto-healer turret on top of the spawner: barrel, body, red plus hat.
		const turretR = SS_HEALER_SIZE * r;
		const hBarrelLen = SS_HEALER_BARREL_LEN * turretR;
		const hBarrelHalfW = (SS_HEALER_BARREL_W / 2) * turretR;
		const hRecoil = this.healerTurret.gunState.position * turretR;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.healerTurret.angle);
		ctx.fillStyle = "#b1b3bc";
		ctx.strokeStyle = "#646568";
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo(-hRecoil, -hBarrelHalfW);
		ctx.lineTo(hBarrelLen - hRecoil, -hBarrelHalfW);
		ctx.lineTo(hBarrelLen - hRecoil, hBarrelHalfW);
		ctx.lineTo(-hRecoil, hBarrelHalfW);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(0, 0, turretR, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
		// Red plus hat rendered without rotation (the hat stays upright).
		const hatR = turretR * 0.7;
		ctx.fillStyle = SS_HEALER_HAT_FILL;
		ctx.strokeStyle = SS_HEALER_HAT_STROKE;
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (let i = 0; i < SS_HEALER_HAT_SHAPE.length; i++) {
			const px = cx + SS_HEALER_HAT_SHAPE[i][0] * hatR;
			const py = cy + SS_HEALER_HAT_SHAPE[i][1] * hatR;
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		}   // end SS_HEALER_ENABLED

		ctx.globalAlpha = 1;
		if (!this.dying) drawHealthBar(ctx, cx, cy, r, this.health, this.maxHealth, game.scale);
	}
}
