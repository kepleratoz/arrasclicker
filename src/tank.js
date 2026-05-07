import { state } from "./state.js";
import { Vec2, formatNumber } from "./utils.js";
import { game } from "./game.js";
import { drawPolygon } from "./render.js";

const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";

const BASE_SHOOT_INTERVAL = 600;
const BULLET_SPEED = 4;
const BULLET_SIZE = 6;
const BASE_BULLET_LIFE = 90;
const TANK_SIZE = 20;
const BASE_TANK_SPEED = 1.2;

function tankShootInterval() { return BASE_SHOOT_INTERVAL * Math.pow(0.9, state.tankReloadUpgrades); }
function tankCanTarget(shape) { return shape.rarity < state.tankRarityCap - 1; }
function tankDamage() { return 1 + 0.5 * state.tankDamageUpgrades; }
function tankBulletLife() { return BASE_BULLET_LIFE * Math.pow(1.2, state.tankPenetrationUpgrades); }
function tankPenetration() { return 1 + state.tankPenetrationUpgrades; }
function tankSpeed() { return BASE_TANK_SPEED * Math.pow(1.33, state.tankSpeedUpgrades); }

class Bullet {
	constructor(pos, angle) {
		this.pos = pos;
		this.velocity = Vec2.circle(angle, BULLET_SPEED);
		this.size = BULLET_SIZE;
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

export class Tank {
	constructor(pos) {
		this.pos = pos;
		this.velocity = new Vec2();
		this.angle = 0;
		this.size = TANK_SIZE;
		this.bullets = [];
		this.shootTime = 0;
	}
	findNearest() {
		let best = null;
		let bestDistSq = Infinity;
		for (const sh of game.shapes) {
			if (sh.isDead() || !tankCanTarget(sh)) continue;
			const dx = sh.pos.x - this.pos.x;
			const dy = sh.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < bestDistSq) { best = sh; bestDistSq = d; }
		}
		return best;
	}
	update() {
		const target = this.findNearest();
		if (target) {
			const dx = target.pos.x - this.pos.x;
			const dy = target.pos.y - this.pos.y;
			this.angle = Math.atan2(dy, dx);
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
				this.bullets.push(new Bullet(muzzle, this.angle));
				this.shootTime = performance.now() + tankShootInterval();
			}
		} else {
			this.velocity.mulVal(0.9);
		}
		this.pos.add(this.velocity);
		const edgeForce = game.room.applyForce(this.pos, this.size, 0.05);
		this.pos.add(edgeForce);
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
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.angle);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = 3 * sc;
		ctx.beginPath();
		ctx.rect(0, -barrelHalfW, barrelLen, barrelHalfW * 2);
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

export function syncTanks() {
	while (game.tanks.length < state.tankCount) {
		const cx = (game.room.minX + game.room.maxX) / 2;
		const cy = (game.room.minY + game.room.maxY) / 2;
		game.tanks.push(new Tank(new Vec2(cx, cy)));
	}
	while (game.tanks.length > state.tankCount) game.tanks.pop();
}
