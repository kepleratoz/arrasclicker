import { state, playerScoreMul, isSmolNamed } from "./state.js";
import { Vec2, darken, colors, formatNumber, REGEN_PER_FRAME, lerpColor, hslToHex } from "./utils.js";
import { mouse } from "./input.js";
import { drawPolygon, drawHealthBar } from "./render.js";
import { game } from "./game.js";
import { Bullet, tankCanTarget, pushOutOfWalls } from "./tank.js";
import { grantGoldEffect, gemEffectDurationMs, goldRareChanceMul, goldClickDamageMul, goldClickScoreMul, goldScoreMul } from "./goldEffects.js";

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
// 0..1 intensity of the DyingLight Q flash. Linear decay over 500 ms from the
// timestamp the player last pressed Q (set by main.js's hotkey handler).
function dyingLightFlashIntensity() {
	const start = game._dyingLightFlash || 0;
	if (!start) return 0;
	const elapsed = performance.now() - start;
	if (elapsed >= 500) return 0;
	return 1 - elapsed / 500;
}

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
export const TYPE_SIZES = [5, 20, 20, 26, 28, 56, 112, 224];
export const TYPE_SIDES = [0, 4, 3, 5, 6, 7, 8, 9];
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
		// Latched at construction so the choice survives evolution: the size
		// shrink applies through every later setType/evolve pass even if the
		// name changes. Covers natural spawns, debug spawns, and the gem
		// octagon path (all go through `new Shape(...)`).
		this.smol = isSmolNamed();
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
		// Stat tracking: set by the click/lightning/poison and tank-bullet
		// damage paths. Read in startDying to attribute the kill.
		this.touchedByClick = false;
		this.touchedByTank = false;
	}
	startDying() {
		if (this.dying) return;
		this.dying = state.shapeDeathAnimEnabled ? 1 : DEATH_FRAMES + 1;
		// Tally the kill for the Gallery (skip gold shapes — they're a separate
		// drop class. Sentries / Spawners override startDying entirely.).
		if (!this.isGold) recordGalleryKill(this.type, this.layers, this.rarity);
		if (this.isGem) this._spawnGemShards();
		// Total kills: count every shape death regardless of source — gold
		// decay, untouched cleanup, anything — so the stat reflects "shapes
		// removed from the arena" rather than "player-attributed kills".
		state.statShapeKillsTotal++;
		// The remaining counters still attribute to the damage source — they
		// drive achievements / progression and shouldn't credit untouched deaths.
		if (this.touchedByClick || this.touchedByTank) {
			if (this.touchedByClick) state.statShapeKillsClick++;
			if (this.touchedByTank) state.statShapeKillsTank++;
			if (this.rarity >= 0) state.statRareKills++;
			if (this.rarity === 0) state.statShinyKills++;
			else if (this.rarity === 1) state.statLegendaryKills++;
			else if (this.rarity === 2) state.statShadowKills++;
			else if (this.rarity === 3) state.statRainbowKills++;
			if (this.isGold) state.statGoldKills++;
		}
	}
	_spawnGemShards() {
		const count = 8 + Math.floor(Math.random() * 5);   // 8..12 fragments.
		const baseSides = this.sides === 0 ? 3 : Math.max(3, this.sides);
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
			const speed = 1.6 + Math.random() * 2.4;
			game.gemShards.push({
				x: this.pos.x,
				y: this.pos.y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				rot: Math.random() * Math.PI * 2,
				rotSpeed: (Math.random() - 0.5) * 0.4,
				size: this.size * (0.18 + Math.random() * 0.16),
				color: this.fillStyle,
				stroke: this.strokeStyle,
				life: 30 + Math.floor(Math.random() * 20),
				sides: baseSides,
			});
		}
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
			const type = types[Math.floor(Math.random() * types.length)];
			// 1 in 500 gold spawns gets upgraded to a gem of the same type. Gems
			// grant the corresponding gold effect on death for a random 5–30
			// minute window (temporary — to be reworked later).
			if (Math.random() < 1 / 10) {
				shape.setType(makeShapeData(type, -1, shape.layers));
				shape.setEvoTime();
				shape.makeGem();
			} else {
				shape.makeGold(type);
			}
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
	// A handful of per-instance random properties make each gem look slightly
	// different (rotated lighting, jittered facet count on egg gems, slightly
	// shifted shade band).
	makeGem() {
		this.isGem = true;
		this.isGold = false;
		// Outline / silhouette stays identical to the standard shape — only the
		// inside texture differs between gems. Per-instance randoms below just
		// shift the shading (phase) and the alpha; vertex positions are NOT
		// jittered any more.
		this._gemPhase = Math.random() * Math.PI * 2;
		if (this.type === 3) {
			// Pentagons keep the deep-shadow look but with a wider swing for
			// more visible facet variation.
			this._gemContrast = 0.35 + Math.random() * 0.20;     // 0.35..0.55
			this._gemMid = 0.55 + Math.random() * 0.15;          // 0.55..0.70
		} else {
			// Other gems: shading stays at-or-above base color but the
			// brightness band is now wide enough that facets read as visibly
			// different shades (e.g. some near-white, some at base color).
			this._gemContrast = 0.22 + Math.random() * 0.18;     // 0.22..0.40
			this._gemMid = 1.10 + Math.random() * 0.10;          // 1.10..1.20
		}
		this._gemAlpha = 0.70 + Math.random() * 0.06;
		// Gem shapes have 250× their normal HP. Healing slowdown (÷3) and the
		// evolution slowdown (×5) are handled inside the regen tick / setEvoTime.
		this.maxHealth *= 250;
		this.health *= 250;
		// Apply the gem score boost. setType skipped it because isGem wasn't set
		// yet at the time it was called; future setType calls (rarity edits via
		// debug) handle it themselves.
		this.score *= this._gemScoreBoost();
		this.setEvoTime();
	}
	// Gem score multiplier: stacks ×100 on top of the rarity multiplier, with a
	// ×1000 floor so common gems still feel valuable (Common Gem = ×1000).
	_gemScoreBoost() {
		const rarityMul = this.rarity === ETHEREAL ? 35000 : Math.pow(10, Math.max(0, this.rarity + 1));
		return Math.max(1000, rarityMul * 100) / rarityMul;
	}
	// Gem-exclusive Octagon variant. Built on top of the standard gem path but
	// recoloured to the poison-click green and flagged so _renderGem swaps in
	// the grid-and-crosses interior pattern.
	makeGemOctagon() {
		this.layers = 1;
		this.setType(makeShapeData(6, -1, 1));   // type 6 = Octagon, size 112.
		this.size *= 0.4;                        // smaller than a standard Octagon.
		// Diamond palette: nearly-white body with a cool-grey stroke. Combined
		// with the higher-contrast facet shading below, faces read as a polished
		// brilliant — bright highlights and visibly darker shadows on adjacent
		// tiles.
		this.fillStyle = "#eef2f7";
		this.strokeStyle = "#6a7480";
		this.makeGem();
		this.isGemOctagon = true;
		// Diamond facets: wider brightness swing, brighter centre, near-opaque
		// so the white reads clean instead of muddying with the arena behind it.
		this._gemContrast = 0.5;
		this._gemMid = 1.22;
		this._gemAlpha = 0.95;
		this.maxHealth *= 0.5;
		this.health = this.maxHealth;
		// Never evolve — keep size and layers fixed regardless of rarity edits.
		this.evoTime = Infinity;
	}
	makeGold(type) {
		// Gem takes priority over Gold — a Gem shape can never become Gold.
		if (this.isGem) return;
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
		// Mobs keep their own size — TYPE_SIZES is tuned for polygons and would
		// shrink a sentry / spawner dramatically on every rarity edit.
		if (!this.isSentry && !this.isSentrySpawner) this.size = data.size;
		this.score = data.score;
		this.type = data.type;
		this.rarity = data.rarity ?? -1;
		// Gems get a ×100 score multiplier that stacks on top of the rarity
		// multiplier, with a 1000× floor for common gems. So Common Gem = ×1000,
		// Shiny Gem = ×1000 (10 × 100), Legendary Gem = ×10000, etc.
		if (this.isGem) this.score *= this._gemScoreBoost();
		// Mobs also keep their own HP / damage from their constructors. The
		// per-type TYPE_BASE_HEALTH would gut a sentry every time rarity edits
		// reran setType. Visual fields (fillStyle/strokeStyle/rarity) above are
		// still updated, so rarity colors and the rainbow/shadow render branches
		// still apply.
		if (this.isSentry || this.isSentrySpawner) return;
		const rarityHealth = this.rarity === ETHEREAL ? 3
			: this.rarity === 3 ? 8
			: this.rarity === 2 ? 6
			: this.rarity === 1 ? 4
			: this.rarity === 0 ? 2
			: 1;
		this.maxHealth = TYPE_BASE_HEALTH[this.type] * rarityHealth;
		// Gem Octagon: rarity scales off a fixed 20000 base instead of the
		// (tiny) per-type base, so rarity changes via debug edition still feel
		// like a gem.
		if (this.isGemOctagon) this.maxHealth = 20000 * rarityHealth;
		// Gem HP bonus stacks multiplicatively with the rarity HP multiplier so
		// e.g. a Shiny Gem keeps both modifiers (×2 rarity × ×250 gem). Without
		// this, a rarity change via debug edition would overwrite the gem boost.
		// Skipped for Gem Octagon which already bakes its own gem scale into the
		// 20000 base above.
		else if (this.isGem) this.maxHealth *= 250;
		this.health = this.maxHealth;
		this.damage = TYPE_BASE_DAMAGE[this.type];   // OSA-style body damage; consumed by Bullet collisions.
		this.penetration = 1;                        // baseline pen for shapes (no upgrade track).
		this.resist = 0;                             // shapes have RESIST = 0 and brst is small enough that resist clamps to 0.
		// Tiered shapes expand so the inner nested rings have room — same scaling
		// the renderer assumes. Triangle layers > 1 get a small extra adjust to
		// keep their proportions sensible.
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		const triangleAdjust = this.sides === 3 && this.layers > 1 ? 2 / (2 + (this.layers - 1)) : 1;
		this.size /= Math.pow(cosFactor, this.layers - 1);
		this.size *= triangleAdjust;
		if (this.isGemOctagon) this.size *= 0.4;
		if (this.smol) this.size *= 0.5;
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
		if (this.isGemOctagon) this.size *= 0.4;
		if (this.smol) this.size *= 0.5;
		this.setEvoTime();
	}
	setEvoTime() {
		const gemMul = this.isGem ? 5 : 1;   // gem shapes evolve 5× slower.
		this.evoTime =
			performance.now() +
			(gemMul * this.layers * (1 + this.type) * 1e4 * (0.5 + Math.random())) / state.shapeEvoNerf[this.type];
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
		if (this.health < this.maxHealth) {
			const regen = this.isGem ? REGEN_PER_FRAME / 3 : REGEN_PER_FRAME;   // gems heal 3× slower.
			this.health = Math.min(this.maxHealth, this.health + regen);
		}
		this.damageBlend *= 0.85;
		if (this.damageBlend < 0.01) this.damageBlend = 0;
		this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
		this._tickPoisons();
		// Right-click repel is gated by a settings toggle. Default is on; users
		// can disable it without losing the left-click damage path.
		const rightActive = mouse.right && (state.rightClickRepelEnabled !== false);
		if ((mouse.leftClick || rightActive) && !game.debugMode && !game.controlledTank) {
			const screenScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * screenScale;
			const dy = mouse.y - this.pos.y * screenScale;
			const cursorR = (mouse.leftClick ? 10 : 100) * (state.cursorSizeMul ?? 1);
			const overlap = cursorR + this.size * screenScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				if (mouse.leftClick) {
					const baseDmg = (1 + (state.clickDamageUpgrades || 0)) * goldClickDamageMul();
					const equipped = state.equippedClickUpgrade;
					// Midas Touch: 0.1% per level (max 0.4% at level 4). Converts the shape
				// into a RANDOM eligible gold-type, not the shape's own type.
				const midasChance = 0.001 * (state.midasLevel || 0);
				if (equipped === "midas" && !this.isGem && midasChance > 0 && Math.random() < midasChance) {
					const types = eligibleGoldTypes();
					this.makeGold(types[Math.floor(Math.random() * types.length)]);
				}
					this._applyHit(baseDmg);
					this.touchedByClick = true;
					state.statClickDamageDealt += baseDmg;
					game._clickHitShape = true;
					if (equipped === "poison" && !this.dying) {
						const maxStacks = state.poisonLevel || 1;
						if (!this.poisons) this.poisons = [];
						const newPoison = { endTime: performance.now() + 10000, dps: baseDmg * 0.25 };
						if (this.poisons.length >= maxStacks) this.poisons.shift();   // bump oldest stack.
						this.poisons.push(newPoison);
					}
					if (equipped === "lightning" && !game._lightningFiredThisFrame) {
						game._lightningFiredThisFrame = true;
						// 10 % per level — level 1 = 10 %, level 4 = 40 %.
						const lvl = state.lightningLevel || 0;
						if (lvl > 0 && Math.random() < 0.1 * lvl) this._fireLightning(baseDmg);
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
		const flashI = dyingLightFlashIntensity();
		if (ctx.globalAlpha <= 0) {
			// Invisible shape: skip the body, but the flash still draws at full
			// intensity so every shape pulses red during a DyingLight Q press.
			if (flashI > 0) {
				ctx.globalAlpha = 1;
				this._drawFlashOverlay(ctx, sizeMul, fade, flashI);
			}
			ctx.globalAlpha = 1;
			return;
		}
		if (this.isGem) {
			this._renderGem(ctx, sizeMul, fade);
			this._drawFlashOverlay(ctx, sizeMul, fade, flashI);
			ctx.globalAlpha = 1;
			return;
		}
		// Non-gem Shadow shapes borrow the gem multi-facet silhouette (visible
		// spokes from centre to each vertex) but skip the per-facet colour
		// shading — every facet shares the same uniform fill.
		if (this.rarity === 2 && !this.isGold) {
			this._renderShadowFaceted(ctx, sizeMul, fade, colorScale);
			this._drawFlashOverlay(ctx, sizeMul, fade, flashI);
			ctx.globalAlpha = 1;
			return;
		}
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
		} else if (this.rarity === 2) {
			// Shadow: slightly darker than the global colors.shadow. Stroke matches
			// the button-style dark border (#222) but slightly translucent so it
			// still feels "shadowy" rather than a hard black outline.
			ctx.fillStyle = darken("#0a0a0a40", colorScale);
			ctx.strokeStyle = darken("#222222b0", colorScale);
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
		// For tiered shapes, an inner ring's vertex sits exactly on an outer
		// ring's edge, and the inner stroke's outward half-width would otherwise
		// poke through the outer edge. Clip the layer rendering to a slightly
		// enlarged outer polygon (margin = stroke half-width) so the outer
		// stroke still shows in full but the inner strokes can't bleed out.
		const tiered = this.layers > 1 && this.sides !== 0;
		if (tiered) {
			const sc = game.scale * game.room.fov;
			// Vertex margin = strokeHalfWidth / cos(π/sides) gives a parallel
			// offset polygon whose edges sit exactly stroke-half-width outside
			// the original edges. Without this scaling, sharp-angle polygons
			// (triangles especially) had their outer edge midpoints pinched
			// inside the clip, making the outline look thin.
			const margin = 1.5 / Math.cos(Math.PI / this.sides);
			const clipR = (this.drawSize * sizeMul + margin) * sc;
			const clipAngle = this.angle + Math.PI / sides;        // matches the outer layer's rotation (i=0).
			ctx.save();
			ctx.beginPath();
			for (let j = 0; j < this.sides; j++) {
				const a = clipAngle + (j / this.sides) * Math.PI * 2;
				ctx.lineTo(this.pos.x * sc + Math.cos(a) * clipR, this.pos.y * sc + Math.sin(a) * clipR);
			}
			ctx.closePath();
			ctx.clip();
		}
		// Shadow rarity uses a translucent fill (alpha 0x20), so the default
		// per-layer fill stack made the corners of tiered shadow shapes (covered
		// only by the outer layer) read as visibly lighter than the inner region
		// (covered by multiple layers). For shadow we only fill once at the
		// outermost layer so the body stays uniform. The outer-layer stroke is
		// clipped to the polygon's interior so it provides a real border without
		// the outward-projecting halo the unclipped stroke produced.
		const isShadow = this.rarity === 2;
		if (isShadow) ctx.lineJoin = "round";
		for (let i = 0; i < this.layers; ++i) {
			drawPolygon(
				ctx,
				this.pos.x,
				this.pos.y,
				this.drawSize * sizeMul * Math.pow(cosFactor, i),
				this.angle + (i & 1 ? 0 : Math.PI / sides),
				this.sides,
			);
			if (!isShadow || i === 0) ctx.fill();
			if (isShadow && i === 0) {
				// Only the inner half of the stroke remains visible (the half
				// inside the polygon), so the border doesn't halo. Doubled
				// lineWidth keeps the visible thickness in line with other rarities.
				ctx.save();
				ctx.clip();
				const prevW = ctx.lineWidth;
				ctx.lineWidth = prevW * 2;
				ctx.stroke();
				ctx.lineWidth = prevW;
				ctx.restore();
			} else {
				ctx.stroke();
			}
		}
		if (tiered) ctx.restore();
		this._drawFlashOverlay(ctx, sizeMul, fade, flashI);
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
			else if (this.isGem) grantGoldEffect(this.type, gemEffectDurationMs());
			this.startDying();
			const gained = Math.round(this.score * goldScoreMul() * goldClickScoreMul() * playerScoreMul());
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
	// Render a gem version of this shape. Outline / silhouette is identical to
	// the standard shape — only the inside is different: each layer is split
	// into shaded triangle facets from the center to each pair of adjacent
	// polygon vertices, drawn slightly translucent. Eggs use 18 facets so the
	// circle has visible internal texture.
	_renderGem(ctx, sizeMul, fade) {
		if (this.isGemOctagon) { this._renderGemOctagon(ctx, sizeMul, fade); return; }
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const baseR = this.drawSize * sizeMul * sc;
		// Rainbow rarity: pull live hue-cycling colors so gem faceting paints
		// over a rainbow body. darken() needs hex, so hslToHex bridges it.
		let base = this.fillStyle;
		let stroke = this.strokeStyle;
		if (this.rarity === 3) {
			const hue = (Date.now() * 0.1) % 360;
			base = hslToHex(hue, 0.8, 0.6);
			stroke = hslToHex(hue, 0.6, 0.35);
		} else if (this.rarity === 2) {
			// Shadow gems: the global shadow colour is translucent (alpha 0x20),
			// which collapses gem facet shading into near-invisibility. Use an
			// opaque dark base so the gem's own _gemAlpha controls translucency.
			// Base must sit above #222 — darken()'s formula uses 34 as an anchor,
			// so a #222 base produces zero facet variation. #3a3a3a gives the
			// darken brightness factor real room to produce visible facets.
			base = "#3a3a3a";
			stroke = "#0f0f0f";
		}
		const phase = this._gemPhase || 0;
		const contrast = this._gemContrast ?? 0.4;
		const mid = this._gemMid ?? 0.5;
		const alpha = this._gemAlpha ?? 0.7;
		// Pentagons may go darker than their base color; everything else stays
		// at the base color or brighter (shade clamped to 1.0).
		const minShade = this.type === 3 ? 0.18 : 1.0;
		const sectorShade = (a) => Math.max(minShade, Math.min(1.5, mid - contrast * Math.sin(a + phase)));

		const isEgg = this.sides === 0;
		// Eggs render as actual concentric circles (ctx.arc) with the same
		// cos(π/3) = 0.5 layer shrink the standard egg uses — so tiered gem
		// eggs keep their nested-circles look instead of collapsing into a
		// barely-shrunk 18-side polygon.
		if (isEgg) {
			const facets = 18;
			const eggCosFactor = 0.5;
			for (let layer = 0; layer < this.layers; ++layer) {
				const r = baseR * Math.pow(eggCosFactor, layer);
				// Opaque circle underlay for the same anti-aliasing seam fix.
				ctx.globalAlpha = fade;
				ctx.fillStyle = darken(base, this._gemMid ?? 1.15);
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.fill();
				for (let i = 0; i < facets; ++i) {
					const a1 = this.angle + (i / facets) * Math.PI * 2;
					const a2 = this.angle + ((i + 1) / facets) * Math.PI * 2;
					ctx.globalAlpha = alpha * fade;
					ctx.fillStyle = darken(base, sectorShade((a1 + a2) / 2));
					ctx.beginPath();
					ctx.moveTo(cx, cy);
					ctx.arc(cx, cy, r, a1, a2);
					ctx.closePath();
					ctx.fill();
				}
				ctx.globalAlpha = (alpha + 0.2) * fade;
				ctx.strokeStyle = stroke;
				ctx.lineWidth = 3 * sc;
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.stroke();
			}
			return;
		}

		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);

		for (let layer = 0; layer < this.layers; ++layer) {
			const r = baseR * Math.pow(cosFactor, layer);
			// Match the standard render's per-layer rotation so a tiered gem
			// has the exact same outline as the corresponding standard tier.
			const layerAngle = this.angle + (layer & 1 ? 0 : Math.PI / sides);
			// Vertex positions: pure polygon, no jitter.
			const verts = new Array(sides);
			for (let i = 0; i < sides; ++i) {
				const a = layerAngle + (i / sides) * Math.PI * 2;
				verts[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a };
			}
			// Underlay: opaque polygon body at the mid shade. Anti-aliased seams
			// between adjacent facet triangles end up showing this base layer
			// instead of the arena behind the shape, so the thin white slivers
			// disappear without strokes overhanging the polygon edge.
			ctx.globalAlpha = fade;
			ctx.fillStyle = darken(base, this._gemMid ?? 1.15);
			ctx.beginPath();
			for (let i = 0; i < sides; ++i) {
				if (i === 0) ctx.moveTo(verts[i].x, verts[i].y);
				else ctx.lineTo(verts[i].x, verts[i].y);
			}
			ctx.closePath();
			ctx.fill();
			// Per-face triangles, shaded — the gem "texture".
			for (let i = 0; i < sides; ++i) {
				const v1 = verts[i];
				const v2 = verts[(i + 1) % sides];
				ctx.globalAlpha = alpha * fade;
				ctx.fillStyle = darken(base, sectorShade((v1.a + v2.a) / 2));
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(v1.x, v1.y);
				ctx.lineTo(v2.x, v2.y);
				ctx.closePath();
				ctx.fill();
			}
			// Outer outline only.
			ctx.globalAlpha = (alpha + 0.2) * fade;
			ctx.strokeStyle = stroke;
			ctx.lineWidth = 3 * sc;
			ctx.lineJoin = "round";
			ctx.beginPath();
			for (let i = 0; i < sides; ++i) {
				if (i === 0) ctx.moveTo(verts[i].x, verts[i].y);
				else ctx.lineTo(verts[i].x, verts[i].y);
			}
			ctx.closePath();
			ctx.stroke();
		}
	}
	// 3×3 grid pattern inside an octagon. The octagon's slant edges land exactly
	// on the diagonal of each corner cell (cell extends from R·sin(π/8) to R·cos(π/8)
	// on each axis), so the "diagonally-split corner tile, outer half empty" look
	// emerges naturally from the outline — no per-corner diagonal drawing needed.
	_renderGemOctagon(ctx, sizeMul, fade) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const R = this.drawSize * sizeMul * sc;
		const alpha = this._gemAlpha ?? 0.72;
		const phase = this._gemPhase || 0;
		const contrast = this._gemContrast ?? 0.3;
		const mid = this._gemMid ?? 1.15;
		let baseColor = this.fillStyle;
		let strokeColor = this.strokeStyle;
		if (this.rarity === 3) {
			const hue = (Date.now() * 0.1) % 360;
			baseColor = hslToHex(hue, 0.8, 0.6);
			strokeColor = hslToHex(hue, 0.6, 0.35);
		} else if (this.rarity === 2) {
			baseColor = "#3a3a3a";
			strokeColor = "#0f0f0f";
		}
		const sectorShade = (a) => Math.max(1.0, Math.min(1.5, mid - contrast * Math.sin(a + phase)));
		const cos8 = Math.cos(Math.PI / 8);
		const sin8 = Math.sin(Math.PI / 8);
		const outer = R * cos8;
		const inner = R * sin8;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.angle);
		// Octagon vertices in local coords (flat sides aligned to the axes).
		const verts = new Array(8);
		for (let i = 0; i < 8; i++) {
			const a = Math.PI / 8 + (i * Math.PI) / 4;
			verts[i] = { x: R * Math.cos(a), y: R * Math.sin(a), a };
		}
		const octPath = new Path2D();
		for (let i = 0; i < 8; i++) {
			if (i === 0) octPath.moveTo(verts[i].x, verts[i].y);
			else octPath.lineTo(verts[i].x, verts[i].y);
		}
		octPath.closePath();
		// Per-tile gem texture: each of the 9 tiles is treated as its own mini-gem,
		// subdivided into 4 triangular sectors radiating from the tile's centre to
		// its 4 corners — the same "fan of shaded triangles" technique the standard
		// gem render uses for polygon sides. Corner tiles get clipped by the
		// octagon's slant edges automatically.
		const tileXs = [-outer, -inner, inner, outer];
		const tileYs = [-outer, -inner, inner, outer];
		ctx.save();
		ctx.clip(octPath);
		ctx.globalAlpha = alpha * fade;
		for (let row = 0; row < 3; row++) {
			for (let col = 0; col < 3; col++) {
				const x0 = tileXs[col];
				const x1 = tileXs[col + 1];
				const y0 = tileYs[row];
				const y1 = tileYs[row + 1];
				const tcx = (x0 + x1) / 2;
				const tcy = (y0 + y1) / 2;
				// Per-tile phase offset keeps each tile's facet pattern distinct.
				const tilePhase = phase + (row * 3 + col) * 0.7;
				const corners = [
					{ x: x0, y: y0 }, { x: x1, y: y0 },
					{ x: x1, y: y1 }, { x: x0, y: y1 },
				];
				// Per-tile opaque underlay at the tile's mid shade. Closes the
				// anti-aliased seams between the 4 facet triangles without
				// strokes that would bleed past the tile rect into neighbours.
				ctx.globalAlpha = fade;
				ctx.fillStyle = darken(baseColor, mid);
				ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
				ctx.globalAlpha = alpha * fade;
				for (let i = 0; i < 4; i++) {
					const c1 = corners[i];
					const c2 = corners[(i + 1) % 4];
					const midA = Math.atan2((c1.y + c2.y) / 2 - tcy, (c1.x + c2.x) / 2 - tcx);
					ctx.fillStyle = darken(baseColor, Math.max(1.0, Math.min(1.5, mid - contrast * Math.sin(midA + tilePhase))));
					ctx.beginPath();
					ctx.moveTo(tcx, tcy);
					ctx.lineTo(c1.x, c1.y);
					ctx.lineTo(c2.x, c2.y);
					ctx.closePath();
					ctx.fill();
				}
			}
		}
		// Inner 3×3 grid lines, matching the outline thickness/colour.
		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = 3 * sc;
		ctx.lineCap = "butt";
		ctx.beginPath();
		ctx.moveTo(-inner, -outer); ctx.lineTo(-inner, outer);
		ctx.moveTo( inner, -outer); ctx.lineTo( inner, outer);
		ctx.moveTo(-outer, -inner); ctx.lineTo(outer, -inner);
		ctx.moveTo(-outer,  inner); ctx.lineTo(outer,  inner);
		ctx.stroke();
		ctx.restore();
		// Outline.
		ctx.globalAlpha = (alpha + 0.2) * fade;
		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = 3 * sc;
		ctx.lineJoin = "round";
		ctx.stroke(octPath);
		ctx.restore();
	}
	// Render for non-gem Shadow shapes. Uses the shadow-gem colour palette,
	// translucent fill + stroke, no facets, and clips every stroke to the
	// outer polygon's interior so the outward half of each line can't form a
	// halo — same containment idea the gem polygons use, just enforced by clip.
	_renderShadowFaceted(ctx, sizeMul, fade, colorScale) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const baseR = this.drawSize * sizeMul * sc;
		const base = darken("#3a3a3a", colorScale);
		const stroke = darken("#0f0f0f", colorScale);
		const bodyAlpha = 0.65 * fade;
		const strokeAlpha = 0.75 * fade;
		ctx.lineJoin = "round";
		const isEgg = this.sides === 0;
		if (isEgg) {
			// Eggs: single body fill at the outer ring + per-layer concentric
			// stroke. Strokes are clipped to the outer circle so the outermost
			// stroke can't form a halo around the body.
			const outerR = baseR;
			ctx.globalAlpha = bodyAlpha;
			ctx.fillStyle = base;
			ctx.beginPath();
			ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
			ctx.fill();
			ctx.save();
			ctx.beginPath();
			ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
			ctx.clip();
			ctx.globalAlpha = strokeAlpha;
			ctx.strokeStyle = stroke;
			for (let layer = 0; layer < this.layers; ++layer) {
				const r = outerR * Math.pow(0.5, layer);
				ctx.lineWidth = (layer === 0 ? 6 : 3) * sc;
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.stroke();
			}
			ctx.restore();
			return;
		}
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		// Build the outer polygon once — used as the body fill path AND as the
		// stroke clip region.
		const outerAngle = this.angle + Math.PI / sides;
		const outerPath = new Path2D();
		for (let i = 0; i < sides; ++i) {
			const a = outerAngle + (i / sides) * Math.PI * 2;
			const px = cx + Math.cos(a) * baseR;
			const py = cy + Math.sin(a) * baseR;
			if (i === 0) outerPath.moveTo(px, py);
			else outerPath.lineTo(px, py);
		}
		outerPath.closePath();
		ctx.globalAlpha = bodyAlpha;
		ctx.fillStyle = base;
		ctx.fill(outerPath);
		// All strokes inside this save/clip — the outer stroke's outward half
		// and any inner-stroke vertex bleed past the outer edge are hidden.
		ctx.save();
		ctx.clip(outerPath);
		ctx.globalAlpha = strokeAlpha;
		ctx.strokeStyle = stroke;
		for (let layer = 0; layer < this.layers; ++layer) {
			const r = baseR * Math.pow(cosFactor, layer);
			const layerAngle = this.angle + (layer & 1 ? 0 : Math.PI / sides);
			// Outer layer: doubled lineWidth — the clip eats the outward half so
			// the visible thickness matches the inner strokes at ~3*sc.
			ctx.lineWidth = (layer === 0 ? 6 : 3) * sc;
			ctx.beginPath();
			for (let i = 0; i < sides; ++i) {
				const a = layerAngle + (i / sides) * Math.PI * 2;
				const px = cx + Math.cos(a) * r;
				const py = cy + Math.sin(a) * r;
				if (i === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
			ctx.stroke();
		}
		ctx.restore();
	}
	// DyingLight flash overlay — red translucent polygon (outer fill + every
	// tier outline) drawn on top of whatever the shape just rendered. Always
	// fires at full intensity × fade regardless of the body's own opacity, so
	// even gem / shadow / invisible shapes get a uniform red pulse.
	_drawFlashOverlay(ctx, sizeMul, fade, intensity) {
		if (intensity <= 0) return;
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const baseR = this.drawSize * sizeMul * sc;
		ctx.save();
		ctx.globalAlpha = intensity * fade;
		ctx.lineWidth = 3 * sc;
		ctx.lineJoin = "round";
		ctx.fillStyle = "#e6373d";
		ctx.strokeStyle = "#7a1c20";
		if (this.sides === 0) {
			// Eggs: nested circles, halve per tier (same shrink the egg render
			// uses). Only the outer layer fills, every layer strokes — matches
			// how tiered shapes show their inner concentric rings.
			for (let layer = 0; layer < this.layers; ++layer) {
				const r = baseR * Math.pow(0.5, layer);
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				if (layer === 0) ctx.fill();
				ctx.stroke();
			}
		} else {
			const sides = Math.max(3, this.sides);
			const cosFactor = Math.cos(Math.PI / sides);
			for (let layer = 0; layer < this.layers; ++layer) {
				const r = baseR * Math.pow(cosFactor, layer);
				const layerAngle = this.angle + (layer & 1 ? 0 : Math.PI / sides);
				ctx.beginPath();
				for (let j = 0; j < sides; ++j) {
					const a = layerAngle + (j / sides) * Math.PI * 2;
					const x = cx + Math.cos(a) * r;
					const y = cy + Math.sin(a) * r;
					if (j === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				}
				ctx.closePath();
				if (layer === 0) ctx.fill();
				ctx.stroke();
			}
		}
		ctx.restore();
	}
	// True when this entity's body will draw translucently — either it's been
	// gemmed (alpha < 1 via _gemAlpha), or its fillStyle carries an alpha
	// component (8-char hex like "#22222220"), or the rarity itself is
	// translucent (shadow / ethereal). Used by mob renders to decide whether
	// the barrel/turret needs the body-mask clip path.
	_bodyIsTranslucent() {
		if (this.isGem) return true;
		if (this.rarity === 2 || this.rarity === 4) return true;
		const fs = this.fillStyle;
		if (typeof fs === "string" && fs.length === 9 && fs.startsWith("#")) {
			const a = parseInt(fs.slice(7, 9), 16);
			return a < 255;
		}
		return false;
	}
	// Render this entity's "body polygon" using the gem facet style — same
	// underlay + per-face shaded triangles + outline trio the standard gem
	// path uses, but parameterised so mobs (Sentry / Spawner) can paint their
	// triangle body the same way when they've been gemmed via debug. Caller
	// passes the polygon vertices already in screen space, plus the centre
	// point the facet fans radiate from.
	_renderGemBody(ctx, cx, cy, verts, fade, strokeWidth) {
		const sides = verts.length;
		const phase = this._gemPhase || 0;
		const contrast = this._gemContrast ?? 0.3;
		const mid = this._gemMid ?? 1.15;
		const alpha = this._gemAlpha ?? 0.7;
		// Mirror the rarity branches in _renderGem so a gem mob set to Rainbow
		// cycles hue, and a gem mob set to Shadow uses the opaque shadow base
		// instead of the translucent global colour.
		let base = this.fillStyle;
		let stroke = this.strokeStyle;
		if (this.rarity === 3) {
			const hue = (Date.now() * 0.1) % 360;
			base = hslToHex(hue, 0.8, 0.6);
			stroke = hslToHex(hue, 0.6, 0.35);
		} else if (this.rarity === 2) {
			base = "#3a3a3a";
			stroke = "#080808";
		}
		const sectorShade = (a) => Math.max(1.0, Math.min(1.5, mid - contrast * Math.sin(a + phase)));
		// Opaque underlay so anti-aliased seams between facets read as the mid
		// shade rather than the arena behind.
		ctx.globalAlpha = fade;
		ctx.fillStyle = darken(base, mid);
		ctx.beginPath();
		for (let i = 0; i < sides; ++i) {
			if (i === 0) ctx.moveTo(verts[i].x, verts[i].y);
			else ctx.lineTo(verts[i].x, verts[i].y);
		}
		ctx.closePath();
		ctx.fill();
		// Shaded facet triangles.
		for (let i = 0; i < sides; ++i) {
			const v1 = verts[i];
			const v2 = verts[(i + 1) % sides];
			const midAngle = Math.atan2((v1.y + v2.y) / 2 - cy, (v1.x + v2.x) / 2 - cx);
			ctx.globalAlpha = alpha * fade;
			ctx.fillStyle = darken(base, sectorShade(midAngle));
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(v1.x, v1.y);
			ctx.lineTo(v2.x, v2.y);
			ctx.closePath();
			ctx.fill();
		}
		// Outline.
		ctx.globalAlpha = (alpha + 0.2) * fade;
		ctx.strokeStyle = stroke;
		ctx.lineWidth = strokeWidth;
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (let i = 0; i < sides; ++i) {
			if (i === 0) ctx.moveTo(verts[i].x, verts[i].y);
			else ctx.lineTo(verts[i].x, verts[i].y);
		}
		ctx.closePath();
		ctx.stroke();
		ctx.globalAlpha = fade;
	}
	// Tick this entity's active poison stacks once per frame. Total damage is
	// the sum of all stacks' dps, divided by 60 to convert "per second" → "per
	// frame". Expired stacks are dropped in-place.
	_tickPoisons() {
		if (!this.poisons || this.poisons.length === 0 || this.dying) return;
		const now = performance.now();
		let totalDps = 0;
		for (let i = this.poisons.length - 1; i >= 0; --i) {
			if (this.poisons[i].endTime <= now) this.poisons.splice(i, 1);
			else totalDps += this.poisons[i].dps;
		}
		if (totalDps > 0) this._applyHit(totalDps / 60);
	}
	// Apply the equipped click-upgrade side effects (poison stack / lightning
	// chain) to a mob that was just clicked. Poison dps and the lightning seed
	// damage are both fed the *mob-scale* damage (10 % of the full click value),
	// so every form of click damage that touches a mob is reduced by 90 %.
	_mobClickEffects(baseDmg) {
		const equipped = state.equippedClickUpgrade;
		const mobDmg = baseDmg * 0.1;
		if (equipped === "poison" && !this.dying) {
			const maxStacks = state.poisonLevel || 1;
			if (!this.poisons) this.poisons = [];
			const newPoison = { endTime: performance.now() + 10000, dps: mobDmg * 0.25 };
			if (this.poisons.length >= maxStacks) this.poisons.shift();
			this.poisons.push(newPoison);
		}
		if (equipped === "lightning" && !game._lightningFiredThisFrame) {
			game._lightningFiredThisFrame = true;
			const lvl = state.lightningLevel || 0;
			// The lightning seed carries the FULL baseDmg — _fireLightning
			// applies the 0.1× per-hop reduction to any mob in the chain.
			if (lvl > 0 && Math.random() < 0.1 * lvl) this._fireLightning(baseDmg);
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
			// Mobs in the chain take 10 % of the chain's damage value (90 %
			// click-damage reduction applied uniformly to lightning hops).
			const isMob = best.isSentry || best.isSentrySpawner;
			const dmg = isMob ? damage * 0.1 : damage;
			best._applyHit(dmg);
			best.touchedByClick = true;
			state.statClickDamageDealt += dmg;
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
		if (!this.neutral) {
			this.score = Math.min(state.score * 0.05, 1e18);
			// Gemmed sentries (debug only) carry the same score multiplier the
			// gem polygons get on top of their normal payout.
			if (this.isGem) this.score *= this._gemScoreBoost();
		}
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
		this._tickPoisons();
		// Click damage (left-click on the body). Mobs eat only 10 % of the
		// player's click damage — see the _mobClickEffects helper for poison /
		// lightning at the same scale.
		if (mouse.leftClick && !game.debugMode && !game.controlledTank && !this.dying) {
			const sScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * sScale;
			const dy = mouse.y - this.pos.y * sScale;
			const overlap = 10 + this.size * sScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				const baseDmg = (1 + (state.clickDamageUpgrades || 0)) * goldClickDamageMul();
				const mobDmg = baseDmg * 0.1;
				this.health -= mobDmg;
				state.statClickDamageDealt += mobDmg;
				this.touchedByClick = true;
				this.damageBlend = 1;
				game._clickHitShape = true;
				this._mobClickEffects(baseDmg);
				if (this.health <= 0) {
					this.startDying();   // sets this.score based on current state.score.
					const gained = Math.round(this.score * goldScoreMul() * goldClickScoreMul() * playerScoreMul());
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
		const blend = state.damageBlendEnabled ? (this.damageBlend ?? 0) * 0.5 : 0;
		const r = this.drawSize * sizeMul * sc;
		const verts = new Array(3);
		for (let i = 0; i < 3; i++) {
			const a = this.angle + (i / 3) * Math.PI * 2;
			verts[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
		}
		// Per-rarity colour override for the non-gem body. Rainbow cycles hue;
		// other rarities just fall through to this.fillStyle which setType
		// already swapped to the rarity colour.
		let bodyFill = this.fillStyle;
		let bodyStroke = this.strokeStyle;
		if (this.rarity === 3) {
			const hue = (Date.now() * 0.1) % 360;
			bodyFill = `hsl(${hue}, 80%, 60%)`;
			bodyStroke = `hsl(${hue}, 60%, 35%)`;
		}
		if (blend > 0 && this.rarity !== 3) {
			bodyFill = lerpColor(bodyFill, "#ff5050", blend);
			bodyStroke = lerpColor(bodyStroke, "#7a1a1a", blend);
		}
		// Translucent bodies (gemmed sentries, or shadow-rarity sentries whose
		// fillStyle carries an alpha component) need the barrel/turret to be
		// masked by the body shape — otherwise the barrel base showing through
		// the see-through body looks wrong. Clip-to-outside-body restricts
		// barrel/turret rendering to pixels the body wouldn't cover.
		const translucent = this._bodyIsTranslucent();
		const drawTurret = () => {
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
			// Barrel is "attached underneath" the turret circle: clip the
			// barrel draw to OUTSIDE the circle so the circle masks its base.
			// Same trick the spawner body uses on its barrels — so the barrel
			// base doesn't double up through the circle even when both are
			// translucent.
			ctx.save();
			const W = ctx.canvas.width, H = ctx.canvas.height;
			ctx.beginPath();
			ctx.rect(-W, -H, 2 * W, 2 * H);
			ctx.arc(0, 0, turretR, 0, Math.PI * 2);
			ctx.clip("evenodd");
			ctx.beginPath();
			ctx.moveTo(-recoil, -barrelHalfW);
			ctx.lineTo(barrelLen - recoil, -barrelHalfW);
			ctx.lineTo(barrelLen - recoil, barrelHalfW);
			ctx.lineTo(-recoil, barrelHalfW);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
			// Turret circle on top, unclipped.
			ctx.beginPath();
			ctx.arc(0, 0, turretR, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		};
		const drawBody = () => {
			if (this.isGem) {
				this._renderGemBody(ctx, cx, cy, verts, fade, 4 * sc);
			} else {
				ctx.fillStyle = bodyFill;
				ctx.strokeStyle = bodyStroke;
				ctx.lineWidth = 4 * sc;
				ctx.lineJoin = "round";
				ctx.beginPath();
				for (let i = 0; i < 3; i++) {
					if (i === 0) ctx.moveTo(verts[i].x, verts[i].y);
					else ctx.lineTo(verts[i].x, verts[i].y);
				}
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
			}
		};
		// Sentry's auto-cannon turret sits ON TOP of the body (not flush with
		// the silhouette like spawner barrels), so it shouldn't be clipped to
		// outside the body. When translucent it just inherits the body alpha
		// so it dims to the same see-through level.
		drawBody();
		ctx.globalAlpha = translucent ? (this._gemAlpha ?? 0.7) * fade : fade;
		drawTurret();
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
		if (this.isGem) this.score *= this._gemScoreBoost();
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
		this._tickPoisons();
		// Click damage — same 10 %-of-click-damage rule sentries use, plus the
		// poison / lightning side-effect helper.
		if (mouse.leftClick && !game.debugMode && !game.controlledTank && !this.dying) {
			const sScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * sScale;
			const dy = mouse.y - this.pos.y * sScale;
			const overlap = 10 + this.size * sScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				const baseDmg = (1 + (state.clickDamageUpgrades || 0)) * goldClickDamageMul();
				const mobDmg = baseDmg * 0.1;
				this.health -= mobDmg;
				state.statClickDamageDealt += mobDmg;
				this.touchedByClick = true;
				this.damageBlend = 1;
				game._clickHitShape = true;
				this._mobClickEffects(baseDmg);
				if (this.health <= 0) {
					this.startDying();
					const gained = Math.round(this.score * goldScoreMul() * goldClickScoreMul() * playerScoreMul());
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
		const blend = state.damageBlendEnabled ? this.damageBlend * 0.5 : 0;
		const ssVerts = new Array(3);
		for (let i = 0; i < 3; i++) {
			const a = this.angle + (i / 3) * Math.PI * 2;
			ssVerts[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
		}
		// Rainbow rarity: hue-cycling fill/stroke for the non-gem body.
		let bodyFill = this.fillStyle;
		let bodyStroke = this.strokeStyle;
		if (this.rarity === 3) {
			const hue = (Date.now() * 0.1) % 360;
			bodyFill = `hsl(${hue}, 80%, 60%)`;
			bodyStroke = `hsl(${hue}, 60%, 35%)`;
		}
		if (blend > 0 && this.rarity !== 3) {
			bodyFill = lerpColor(bodyFill, "#ff5050", blend);
			bodyStroke = lerpColor(bodyStroke, "#7a1a1a", blend);
		}
		const sideMid = r * 0.5;                   // apothem of equilateral triangle.
		const barrelLen = SS_BARREL_LEN * r;
		const innerHW = (SS_BARREL_INNER_W / 2) * r;
		const outerHW = (SS_BARREL_OUTER_W / 2) * r;
		const inset = SS_BARREL_INSET * r;
		const drawBarrels = () => {
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
		};
		const drawBody = () => {
			if (this.isGem) {
				this._renderGemBody(ctx, cx, cy, ssVerts, fade, lw);
			} else {
				ctx.fillStyle = bodyFill;
				ctx.strokeStyle = bodyStroke;
				ctx.lineWidth = lw;
				ctx.lineJoin = "round";
				ctx.beginPath();
				for (let i = 0; i < 3; i++) {
					if (i === 0) ctx.moveTo(ssVerts[i].x, ssVerts[i].y);
					else ctx.lineTo(ssVerts[i].x, ssVerts[i].y);
				}
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
			}
		};
		// Translucent bodies (gemmed spawner, or shadow-rarity spawner) get the
		// same outside-body clip for barrels so the inset bases don't show
		// through the see-through body.
		if (this._bodyIsTranslucent()) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
			for (let i = ssVerts.length - 1; i >= 0; --i) {
				if (i === ssVerts.length - 1) ctx.moveTo(ssVerts[i].x, ssVerts[i].y);
				else ctx.lineTo(ssVerts[i].x, ssVerts[i].y);
			}
			ctx.closePath();
			ctx.clip("evenodd");
			ctx.globalAlpha = (this._gemAlpha ?? 0.7) * fade;
			drawBarrels();
			ctx.restore();
			ctx.globalAlpha = fade;
			drawBody();
		} else {
			drawBarrels();
			drawBody();
		}

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
