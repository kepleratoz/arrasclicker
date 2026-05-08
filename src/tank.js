import { state } from "./state.js";
import { Vec2, formatNumber } from "./utils.js";
import { game } from "./game.js";
import { mouse, keys } from "./input.js";
import { drawPolygon } from "./render.js";
import { TANK_DEFS } from "./tankDefs.js";

const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";
const ALERT_COLOR = "#ff3030";

const BASE_SHOOT_INTERVAL = 600;
const BULLET_SPEED = 4;
const BULLET_SIZE = 6;
const BASE_BULLET_LIFE = 90;
const TANK_SIZE = 12;
const BASE_TANK_SPEED = 1.2;
const UPGRADE_LEVEL = 15;
const UPGRADES_ENABLED = false;

function tankShootInterval() { return BASE_SHOOT_INTERVAL * Math.pow(0.9, state.tankReloadUpgrades); }
function tankCanTarget(shape) { return shape.rarity < state.tankRarityCap - 1; }
function tankBaseDamage() { return 1 + 0.5 * state.tankDamageUpgrades; }
function tankBulletLife() { return BASE_BULLET_LIFE * Math.pow(1.2, state.tankPenetrationUpgrades); }
function tankPenetration() { return 1 + state.tankPenetrationUpgrades; }
function tankSpeed() { return BASE_TANK_SPEED * Math.pow(1.33, state.tankSpeedUpgrades); }

class Bullet {
	constructor(pos, angle, tank, shootCfg) {
		const speedMul = shootCfg.speed ?? 1;
		const sizeMul = shootCfg.size ?? 1;
		const damageMul = shootCfg.damage ?? 1;
		const rangeMul = shootCfg.range ?? 1;
		this.pos = pos;
		this.velocity = Vec2.circle(angle, BULLET_SPEED * speedMul);
		this.size = BULLET_SIZE * sizeMul;
		this.tank = tank;
		this.life = tankBulletLife() * rangeMul;
		this.damage = tankBaseDamage() * damageMul;
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
		this.bullets = [];
		this.target = null;
		this.level = 1;
		this.xp = 0;
		this.deduction = 0;
		this.levelUpScore = scoreForLevel(this.level);
		this.setClass("basic");
		this.recomputeSize();
	}
	setClass(defKey) {
		this.defKey = defKey;
		const def = TANK_DEFS[defKey];
		this.classification = def.label;
		this.gunStates = def.guns.map((g) => ({
			gunPosition: 0,
			gunMotion: 0,
			shootTime: 0,
			initialDelay: g.shoot ? (g.shoot.delay ?? 0) : 0,
			delayInitialized: false,
		}));
	}
	canUpgrade() {
		if (!UPGRADES_ENABLED) return false;
		const def = TANK_DEFS[this.defKey];
		return this.level >= UPGRADE_LEVEL && def.upgrades && def.upgrades.length > 0;
	}
	upgradeTo(defKey) {
		const def = TANK_DEFS[this.defKey];
		if (!def.upgrades || !def.upgrades.includes(defKey)) return;
		this.setClass(defKey);
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
		const isControlled = game.controlledTank === this;
		let target;
		if (isControlled) {
			const sc = game.scale * game.room.fov;
			const mouseWorldX = mouse.x / sc;
			const mouseWorldY = mouse.y / sc;
			this.angle = Math.atan2(mouseWorldY - this.pos.y, mouseWorldX - this.pos.x);
			let dx = 0, dy = 0;
			if (keys.pressed.has("KeyW")) dy -= 1;
			if (keys.pressed.has("KeyS")) dy += 1;
			if (keys.pressed.has("KeyA")) dx -= 1;
			if (keys.pressed.has("KeyD")) dx += 1;
			const len = Math.sqrt(dx * dx + dy * dy);
			const speed = tankSpeed();
			if (len > 0) {
				this.velocity.x = (dx / len) * speed;
				this.velocity.y = (dy / len) * speed;
			} else {
				this.velocity.mulVal(0.5);
			}
			this.target = null;
			target = mouse.left ? this : null;
		} else {
			const claimed = new Set();
			for (const t of game.tanks) {
				if (t === this) break;
				if (t.target && !t.target.isDead()) claimed.add(t.target);
			}
			target = this.findNearest(claimed);
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
			} else {
				this.velocity.mulVal(0.9);
			}
		}
		this.shootGuns(target);
		if (mouse.right && !isControlled) {
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
	shootGuns(target) {
		const def = TANK_DEFS[this.defKey];
		const now = performance.now();
		for (let i = 0; i < def.guns.length; ++i) {
			const gun = def.guns[i];
			const gs = this.gunStates[i];
			if (gun.shoot) {
				const reloadMul = gun.shoot.reload ?? 1;
				const interval = tankShootInterval() * reloadMul;
				if (!gs.delayInitialized) {
					gs.shootTime = now + gs.initialDelay * interval;
					gs.delayInitialized = true;
				}
				if (target && now > gs.shootTime) {
					const cosA = Math.cos(this.angle);
					const sinA = Math.sin(this.angle);
					const mountX = this.pos.x + (gun.x * cosA - gun.y * sinA) * this.size;
					const mountY = this.pos.y + (gun.x * sinA + gun.y * cosA) * this.size;
					const barrelDir = this.angle + (gun.angle ?? 0);
					const tipX = mountX + Math.cos(barrelDir) * gun.length * this.size;
					const tipY = mountY + Math.sin(barrelDir) * gun.length * this.size;
					this.bullets.push(new Bullet(new Vec2(tipX, tipY), barrelDir, this, gun.shoot));
					gs.shootTime = now + interval;
					gs.gunMotion += RECOIL_IMPULSE;
				}
			}
			gs.gunMotion -= RECOIL_SPRING * gs.gunPosition;
			gs.gunPosition += gs.gunMotion;
			if (gs.gunPosition < 0) { gs.gunPosition = 0; gs.gunMotion = -gs.gunMotion; }
			if (gs.gunMotion > 0) gs.gunMotion *= RECOIL_DAMP;
		}
	}
	render(ctx) { renderTank(ctx, this, this.pos.x, this.pos.y, this.angle, this.size, true); }
}

function renderTank(ctx, tank, posX, posY, angle, size, applyRoomFov) {
	const sc = applyRoomFov ? game.scale * game.room.fov : game.scale;
	const cx = posX * sc;
	const cy = posY * sc;
	const def = TANK_DEFS[tank.defKey];
	const cosA = Math.cos(angle);
	const sinA = Math.sin(angle);
	for (let i = 0; i < def.guns.length; ++i) {
		const gun = def.guns[i];
		const gs = tank.gunStates[i];
		const mountX = cx + (gun.x * cosA - gun.y * sinA) * size * sc;
		const mountY = cy + (gun.x * sinA + gun.y * cosA) * size * sc;
		const barrelDir = angle + (gun.angle ?? 0);
		const aspect = gun.aspect ?? 1;
		const halfW = (gun.width / 2) * size * sc;
		const h0 = aspect > 0 ? halfW * aspect : halfW;
		const h1 = aspect > 0 ? halfW : halfW * -aspect;
		const recoilOffset = (gs?.gunPosition ?? 0) * size * sc;
		const barrelLen = gun.length * size * sc;
		ctx.save();
		ctx.translate(mountX, mountY);
		ctx.rotate(barrelDir);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = 3 * sc;
		ctx.beginPath();
		ctx.moveTo(-recoilOffset, h1);
		ctx.lineTo(barrelLen - recoilOffset, h0);
		ctx.lineTo(barrelLen - recoilOffset, -h0);
		ctx.lineTo(-recoilOffset, -h1);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}
	ctx.fillStyle = BODY_FILL;
	ctx.strokeStyle = BODY_STROKE;
	ctx.lineWidth = 3 * sc;
	ctx.beginPath();
	ctx.arc(cx, cy, size * sc, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
	if (applyRoomFov) {
		for (const b of tank.bullets) b.render(ctx);
		if (game.controlledTank === tank) {
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 3 * game.scale;
			ctx.setLineDash([6 * game.scale, 4 * game.scale]);
			ctx.beginPath();
			ctx.arc(cx, cy, size * sc + 8 * game.scale, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		if (tank.canUpgrade()) {
			const exclamY = cy - size * sc - 18 * game.scale;
			ctx.font = "bold " + 36 * game.scale + "px Ubuntu";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.strokeStyle = "#222";
			ctx.lineWidth = 6 * game.scale;
			ctx.strokeText("!", cx, exclamY);
			ctx.fillStyle = ALERT_COLOR;
			ctx.fillText("!", cx, exclamY);
		}
	}
}

export function renderTankPreview(ctx, tank, x, y, size) {
	const angle = -Math.PI / 2;
	const def = TANK_DEFS[tank.defKey];
	const cosA = Math.cos(angle);
	const sinA = Math.sin(angle);
	for (let i = 0; i < def.guns.length; ++i) {
		const gun = def.guns[i];
		const mountX = x + (gun.x * cosA - gun.y * sinA) * size;
		const mountY = y + (gun.x * sinA + gun.y * cosA) * size;
		const barrelDir = angle + (gun.angle ?? 0);
		const aspect = gun.aspect ?? 1;
		const halfW = (gun.width / 2) * size;
		const h0 = aspect > 0 ? halfW * aspect : halfW;
		const h1 = aspect > 0 ? halfW : halfW * -aspect;
		const barrelLen = gun.length * size;
		ctx.save();
		ctx.translate(mountX, mountY);
		ctx.rotate(barrelDir);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(0, h1);
		ctx.lineTo(barrelLen, h0);
		ctx.lineTo(barrelLen, -h0);
		ctx.lineTo(0, -h1);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}
	ctx.fillStyle = BODY_FILL;
	ctx.strokeStyle = BODY_STROKE;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(x, y, size, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
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
