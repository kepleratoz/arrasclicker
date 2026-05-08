import { state } from "./state.js";
import { Vec2, formatNumber } from "./utils.js";
import { game } from "./game.js";
import { mouse } from "./input.js";
import { drawPolygon } from "./render.js";

const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";

const BASE_SHOOT_INTERVAL = 600;
const BULLET_SPEED = 4;
const BULLET_SIZE = 6;
const BASE_BULLET_LIFE = 90;
const TANK_SIZE = 12;
const BASE_TANK_SPEED = 1.2;

function tankShootInterval() { return BASE_SHOOT_INTERVAL * Math.pow(0.9, state.tankReloadUpgrades); }
function tankCanTarget(shape) { return shape.rarity < state.tankRarityCap - 1; }
function tankDamage() { return 1 + 0.5 * state.tankDamageUpgrades; }
function tankBulletLife() { return BASE_BULLET_LIFE * Math.pow(1.2, state.tankPenetrationUpgrades); }
function tankPenetration() { return 1 + state.tankPenetrationUpgrades; }
function tankSpeed() { return BASE_TANK_SPEED * Math.pow(1.33, state.tankSpeedUpgrades); }

class Bullet {
	constructor(pos, angle, tank) {
		this.pos = pos;
		this.velocity = Vec2.circle(angle, BULLET_SPEED);
		this.size = BULLET_SIZE;
		this.tank = tank;
		this.life = tankBulletLife();
		this.damage = tankDamage();
		this.hitsLeft = tankPenetration();
		this.hitShapes = new Set();
		this.dead = false;
	}
	update() {
		this.pos.add(this.velocity);
		this.life -= 1;
		if (this.life <= 0) { this.dead = true; return; }
		for (const shape of game.shapes) {
			if (shape.isDead() || this.hitShapes.has(shape) || !tankCanTarget(shape)) continue;
			const dx = shape.pos.x - this.pos.x;
			const dy = shape.pos.y - this.pos.y;
			if (Math.sqrt(dx * dx + dy * dy) < shape.size + this.size) {
				shape.health -= this.damage;
				this.hitShapes.add(shape);
				if (shape.isDead()) {
					state.score += shape.score;
					const sc = game.scale * game.room.fov;
					game.flyingText.push({
						x: shape.pos.x * sc,
						y: shape.pos.y * sc,
						alpha: 1,
						text: "+" + formatNumber(shape.score),
					});
					if (this.tank) this.tank.gainXp(getJackpot(shapeXpValue(shape)));
				}
				this.hitsLeft -= 1;
				if (this.hitsLeft <= 0) { this.dead = true; return; }
			}
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		ctx.fillStyle = BODY_FILL;
		ctx.strokeStyle = BODY_STROKE;
		ctx.lineWidth = 3 * sc;
		drawPolygon(ctx, this.pos.x, this.pos.y, this.size, 0, 0);
		ctx.fill();
		ctx.stroke();
	}
}

const MAX_TURN_PER_FRAME = 0.12;
const RECOIL_IMPULSE = 0.18;
const RECOIL_SPRING = 0.2;
const RECOIL_DAMP = 0.5;

function scoreForLevel(level) { return Math.ceil(Math.pow(level, 3) * 0.3083); }
function levelSizeMultiplier(level) { return 1 + Math.min(42, level) / 42; }
function getJackpot(x) { return x > 39450 ? Math.pow(x - 26300, 0.85) + 26300 : x / 1.5; }

const SHAPE_XP_VALUES = [5, 30, 120, 400, 500];
function shapeXpValue(shape) {
	const base = SHAPE_XP_VALUES[shape.type] ?? 1;
	const layerMul = shape.layers || 1;
	const rarityMul = shape.rarity >= 0 ? Math.pow(3, shape.rarity + 1) : 1;
	return base * layerMul * rarityMul;
}

export class Tank {
	constructor(pos) {
		this.pos = pos;
		this.velocity = new Vec2();
		this.angle = 0;
		this.size = TANK_SIZE;
		this.bullets = [];
		this.shootTime = 0;
		this.target = null;
		this.gunPosition = 0;
		this.gunMotion = 0;
		this.classification = "Basic";
		this.level = 1;
		this.xp = 0;
		this.deduction = 0;
		this.levelUpScore = scoreForLevel(this.level);
		this.recomputeSize();
	}
	recomputeSize() { this.size = TANK_SIZE * levelSizeMultiplier(this.level); }
	gainXp(n) {
		this.xp += n;
		while (this.xp >= this.levelUpScore) {
			this.deduction = this.levelUpScore;
			this.level += 1;
			this.levelUpScore = scoreForLevel(this.level);
		}
		this.recomputeSize();
	}
	xpProgress() { return this.xp - this.deduction; }
	xpNeeded() { return this.levelUpScore - this.deduction; }
	findNearest(claimed) {
		let best = null;
		let bestDistSq = Infinity;
		for (const sh of game.shapes) {
			if (sh.isDead() || !tankCanTarget(sh) || claimed.has(sh)) continue;
			const dx = sh.pos.x - this.pos.x;
			const dy = sh.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < bestDistSq) { best = sh; bestDistSq = d; }
		}
		return best;
	}
	update() {
		const claimed = new Set();
		for (const t of game.tanks) {
			if (t === this) break;
			if (t.target && !t.target.isDead()) claimed.add(t.target);
		}
		const target = this.findNearest(claimed);
		this.target = target;
		if (target) {
			const dx = target.pos.x - this.pos.x;
			const dy = target.pos.y - this.pos.y;
			const targetAngle = Math.atan2(dy, dx);
			let delta = targetAngle - this.angle;
			while (delta > Math.PI) delta -= Math.PI * 2;
			while (delta < -Math.PI) delta += Math.PI * 2;
			this.angle += Math.max(-MAX_TURN_PER_FRAME, Math.min(MAX_TURN_PER_FRAME, delta));
			const dist = Math.sqrt(dx * dx + dy * dy);
			const desired = Math.max(60, target.size + this.size + 30);
			const speed = tankSpeed();
			if (dist > desired) {
				this.velocity.x = Math.cos(this.angle) * speed;
				this.velocity.y = Math.sin(this.angle) * speed;
			} else {
				this.velocity.mulVal(0.5);
			}
			if (performance.now() > this.shootTime) {
				const muzzle = this.pos.clone();
				muzzle.add(Vec2.circle(this.angle, this.size * 1.6));
				this.bullets.push(new Bullet(muzzle, this.angle, this));
				this.shootTime = performance.now() + tankShootInterval();
				this.gunMotion += RECOIL_IMPULSE;
			}
		} else {
			this.velocity.mulVal(0.9);
		}
		this.gunMotion -= RECOIL_SPRING * this.gunPosition;
		this.gunPosition += this.gunMotion;
		if (this.gunPosition < 0) { this.gunPosition = 0; this.gunMotion = -this.gunMotion; }
		if (this.gunMotion > 0) this.gunMotion *= RECOIL_DAMP;
		if (mouse.right) {
			const screenScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * screenScale;
			const dy = mouse.y - this.pos.y * screenScale;
			const overlap = 100 + this.size * screenScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				const angle = Math.atan2(dy, dx);
				const push = Vec2.circle(angle, overlap / 100);
				this.velocity.sub(push);
			}
		}
		this.pos.add(this.velocity);
		const edgeForce = game.room.applyForce(this.pos, this.size, 0.05);
		this.pos.add(edgeForce);
		this.velocity.mulVal(0.92);
		for (let i = this.bullets.length - 1; i >= 0; --i) {
			this.bullets[i].update();
			if (this.bullets[i].dead) this.bullets.splice(i, 1);
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const barrelLen = this.size * 1.7 * sc;
		const barrelHalfW = this.size * 0.35 * sc;
		const recoilOffset = this.gunPosition * this.size * sc;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.angle);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = 3 * sc;
		ctx.beginPath();
		ctx.rect(-recoilOffset, -barrelHalfW, barrelLen, barrelHalfW * 2);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
		ctx.fillStyle = BODY_FILL;
		ctx.strokeStyle = BODY_STROKE;
		ctx.lineWidth = 3 * sc;
		ctx.beginPath();
		ctx.arc(cx, cy, this.size * sc, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		for (const b of this.bullets) b.render(ctx);
	}
}

export function tankUnderMouse() {
	const sc = game.scale * game.room.fov;
	for (const t of game.tanks) {
		const dx = mouse.x - t.pos.x * sc;
		const dy = mouse.y - t.pos.y * sc;
		if (Math.sqrt(dx * dx + dy * dy) < t.size * sc) return t;
	}
	return null;
}

export function syncTanks() {
	while (game.tanks.length < state.tankCount) {
		const cx = (game.room.minX + game.room.maxX) / 2;
		const cy = (game.room.minY + game.room.maxY) / 2;
		game.tanks.push(new Tank(new Vec2(cx, cy)));
	}
	while (game.tanks.length > state.tankCount) game.tanks.pop();
}
