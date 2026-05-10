import { state } from "./state.js";
import { Vec2, formatNumber, lerpColor, REGEN_PER_FRAME } from "./utils.js";
import { game } from "./game.js";
import { mouse, keys } from "./input.js";
import { drawPolygon, drawHealthBar, drawText } from "./render.js";
import { TANK_DEFS } from "./tankDefs.js";

const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
const DEAD_FILL = "#707070";          // gray body for dying/spawning tanks.
const DEAD_STROKE = "#3f3f3f";
const DEATH_ANIM_MS = 2000;          // blue → gray blend duration on death.
const CORPSE_FADE_MS = 300;          // fade-out + expand at the end of the dead window.
const SPAWN_FADE_MS = 300;           // reverse fade-in + shrink when respawning.
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";
const ALERT_COLOR = "#ff3030";

const BASE_SHOOT_INTERVAL = 600;
const BULLET_SPEED = 4;
const BASE_BULLET_LIFE = 90;
const TANK_SIZE = 12;
const BASE_TANK_SPEED = 1.2;
const UPGRADE_LEVEL = 15;
const UPGRADES_ENABLED = true;

function tankShootInterval() { return BASE_SHOOT_INTERVAL * Math.pow(0.9, state.tankReloadUpgrades); }
function tankCanTarget(shape) { return shape.rarity < state.tankRarityCap - 1; }
function tankCanLockOn(shape) { return tankCanTarget(shape) && shape.rarity !== 4; }
function tankDamageMul(shape) { return shape.rarity === 4 ? 0.1 : 1; }
function tankBaseDamage() { return 1 + 0.5 * state.tankDamageUpgrades; }
function tankBulletLife() { return BASE_BULLET_LIFE; }
function tankBulletHealth() { return 5 * Math.pow(1.2, state.tankHealthUpgrades); }
function tankSpeed() { return BASE_TANK_SPEED * Math.pow(1.33, state.tankSpeedUpgrades); }
function tankBulletSpeedMul() { return Math.pow(1.2, state.tankBulletSpeedUpgrades); }
function tankMaxHealth() { return 10 * (1 + 0.1 * (state.tankHpUpgrades || 0)); }
const COLLISION_COOLDOWN_FRAMES = 3; // 60fps / 20 hits-per-second
const DEATH_FRAMES = 18; // ~300ms at 60fps to match OSA's getFade decay

export class Bullet {
	constructor(pos, angle, tank, shootCfg, gunWidth, shudderMul = 1, sizeOverride = null) {
		const speedMul = shootCfg.speed ?? 1;
		const sizeMul = shootCfg.size ?? 1;
		const damageMul = shootCfg.damage ?? 1;
		const rangeMul = shootCfg.range ?? 1;
		const healthMul = shootCfg.health ?? 1;
		this.pos = pos;
		this.angle = angle;
		this.isTrap = !!shootCfg.isTrap;
		const upgradeSpeedMul = shootCfg.ignoreUpgradeSpeed
			? 1
			: this.isTrap ? 1 + (tankBulletSpeedMul() - 1) * 0.5 : tankBulletSpeedMul();
		this.velocity = Vec2.circle(angle, BULLET_SPEED * speedMul * shudderMul * upgradeSpeedMul);
		this.size = sizeOverride ?? (tank.size * gunWidth * sizeMul) / 2;
		this.tank = tank;
		this.life = tankBulletLife() * rangeMul * (this.isTrap ? 3 : 1);
		this.damage = (shootCfg.ignoreUpgradeDamage ? 1 : tankBaseDamage()) * damageMul;
		this.health = (shootCfg.ignoreUpgradeHealth ? 5 : tankBulletHealth()) * healthMul;
		this.maxHealth = this.health;
		this.collisionCooldown = 0;
		this.dying = 0;
		this.dead = false;
	}
	startDying() {
		if (this.dying) return;
		if (!state.bulletDeathAnimEnabled) { this.dead = true; return; }
		this.dying = 1;
	}
	takeDamage(n) {
		if (this.dying) return;
		this.health -= n;
		if (this.health <= 0) this.startDying();
	}
	update() {
		this.pos.add(this.velocity);
		if (this.isTrap) {
			this.velocity.mulVal(0.97);
			this.angle += this.velocity.length() * 0.04;
		}
		if (!this.dying && this.health < this.maxHealth) {
			this.health = Math.min(this.maxHealth, this.health + REGEN_PER_FRAME);
		}
		if (this.dying) {
			this.dying += 1;
			if (this.dying > DEATH_FRAMES) this.dead = true;
			return;
		}
		this.life -= 1;
		if (this.life <= 0) { this.startDying(); return; }
		if (this.collisionCooldown > 0) { this.collisionCooldown -= 1; return; }
		for (const shape of game.shapes) {
			if (shape.isDead() || !tankCanTarget(shape)) continue;
			const dx = shape.pos.x - this.pos.x;
			const dy = shape.pos.y - this.pos.y;
			if (Math.sqrt(dx * dx + dy * dy) < shape.size + this.size) {
				shape.health -= this.damage * tankDamageMul(shape);
				this.health -= shape.type + 1;
				if (shape.health <= 0 && !shape.dying) {
					shape.startDying();
					state.score += shape.score;
					const sc = game.scale * game.room.fov;
					game.flyingText.push({
						x: shape.pos.x * sc,
						y: shape.pos.y * sc,
						alpha: 1,
						text: "+" + formatNumber(shape.score),
					});
					if (this.tank && typeof this.tank.gainXp === "function") this.tank.gainXp(getJackpot(shapeXpValue(shape)));
				}
				this.collisionCooldown = COLLISION_COOLDOWN_FRAMES;
				if (this.health <= 0) { this.startDying(); return; }
				break;
			}
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const fade = this.dying ? Math.max(0, 1 - this.dying / DEATH_FRAMES) : 1;
		const sizeMul = 1 + 0.5 * (1 - fade);
		ctx.globalAlpha = fade;
		ctx.fillStyle = BODY_FILL;
		ctx.strokeStyle = BODY_STROKE;
		ctx.lineWidth = 4 * sc;
		if (this.isTrap) {
			drawTrap(ctx, this.pos.x * sc, this.pos.y * sc, this.size * sizeMul * sc, this.angle);
		} else {
			drawPolygon(ctx, this.pos.x, this.pos.y, this.size * sizeMul, 0, 0);
		}
		ctx.fill();
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
}


function drawTrap(ctx, x, y, radius, angle) {
	const sides = 3;
	const dip = 1 - 6 / (sides * sides); // OSA star formula → 0.333 for 3 points
	const inner = radius * dip;
	ctx.beginPath();
	ctx.moveTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
	for (let i = 0; i < sides; ++i) {
		const htheta = ((i + 0.5) / sides) * 2 * Math.PI + angle;
		const theta = ((i + 1) / sides) * 2 * Math.PI + angle;
		ctx.lineTo(x + inner * Math.cos(htheta), y + inner * Math.sin(htheta));
		ctx.lineTo(x + radius * Math.cos(theta), y + radius * Math.sin(theta));
	}
	ctx.closePath();
}

const MAX_TURN_PER_FRAME = 0.12;
const DEATH_TURN_PER_FRAME = MAX_TURN_PER_FRAME * 1.5;  // ~normal turn speed for the random spin on death.
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
		this.maxHealth = tankMaxHealth();
		this.health = this.maxHealth;
		this.respawnAt = null;       // performance.now() timestamp; null while alive.
		this.deathPos = null;
		this.deathStartTime = null;  // when current death animation started.
		this.spawnStartTime = null;  // when current spawn animation started.
	}
	isDead() { return this.respawnAt !== null; }
	die() {
		const now = performance.now();
		this.deathPos = new Vec2(this.pos.x, this.pos.y);
		// Pick a death-target angle that's a noticeable turn (90°–270°) from the current heading.
		const sign = Math.random() < 0.5 ? -1 : 1;
		this.deathTargetAngle = this.angle + sign * (Math.PI * 0.5 + Math.random() * Math.PI);
		this.respawnAt = now + 30000;
		this.deathStartTime = now;
		this.spawnStartTime = null;
		this.velocity = new Vec2();
		this.target = null;
		if (game.controlledTank === this) game.controlledTank = null;
	}
	respawn() {
		let nearest = null;
		let bestDistSq = Infinity;
		for (const sg of game.sieges) {
			const dx = sg.pos.x - this.deathPos.x;
			const dy = sg.pos.y - this.deathPos.y;
			const d = dx * dx + dy * dy;
			if (d < bestDistSq) { bestDistSq = d; nearest = sg; }
		}
		if (nearest) {
			this.pos.x = nearest.pos.x;
			this.pos.y = nearest.pos.y;
		}
		this.level = 1;
		this.xp = 0;
		this.deduction = 0;
		this.levelUpScore = scoreForLevel(this.level);
		this.setClass("basic");
		this.recomputeSize();
		this.maxHealth = tankMaxHealth();
		this.health = this.maxHealth;
		this.velocity = new Vec2();
		this.respawnAt = null;
		this.deathPos = null;
		this.deathStartTime = null;
		this.spawnStartTime = performance.now();
	}
	syncMaxHealth() {
		const newMax = tankMaxHealth();
		if (newMax !== this.maxHealth) {
			const ratio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
			this.maxHealth = newMax;
			this.health = newMax * ratio;
		}
	}
	takeDamage(n) {
		if (this.isDead()) return;
		this.health = Math.max(0, this.health - n);
		if (this.health <= 0) this.die();
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
			if (sh.isDead() || !tankCanLockOn(sh) || claimed.has(sh)) continue;
			const dx = sh.pos.x - this.pos.x;
			const dy = sh.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (d < bestDistSq) { best = sh; bestDistSq = d; }
		}
		return best;
	}
	update() {
		if (this.isDead()) {
			const now = performance.now();
			if (now >= this.respawnAt) this.respawn();
			else {
				if (this.deathTargetAngle != null) {
					let delta = this.deathTargetAngle - this.angle;
					while (delta > Math.PI) delta -= Math.PI * 2;
					while (delta < -Math.PI) delta += Math.PI * 2;
					this.angle += Math.max(-DEATH_TURN_PER_FRAME, Math.min(DEATH_TURN_PER_FRAME, delta));
				}
				for (let i = this.bullets.length - 1; i >= 0; --i) {
					this.bullets[i].update();
					if (this.bullets[i].dead) this.bullets.splice(i, 1);
				}
				return;
			}
		}
		this.syncMaxHealth();
		if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + REGEN_PER_FRAME);
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
					const sprayRad = (gun.shoot.spray ?? 0) * 0.12;
					const shudderAmt = (gun.shoot.shudder ?? 0) * 0.12;
					const fireAngle = barrelDir + (Math.random() - 0.5) * sprayRad;
					const shudderMul = 1 + (Math.random() - 0.5) * shudderAmt;
					this.bullets.push(new Bullet(new Vec2(tipX, tipY), fireAngle, this, gun.shoot, gun.width, shudderMul));
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
	render(ctx) {
		const now = performance.now();
		const sc = game.scale * game.room.fov;
		// Bullets always render at full opacity, regardless of corpse/spawn fade.
		for (const b of this.bullets) b.render(ctx);
		if (this.isDead()) {
			const remaining = this.respawnAt - now;
			if (remaining < CORPSE_FADE_MS) {
				// Corpse fade: become fainter and expand out, like a bullet/shape death.
				const p = Math.max(0, Math.min(1, 1 - remaining / CORPSE_FADE_MS));
				ctx.globalAlpha = 1 - p;
				renderTank(ctx, this, this.deathPos.x, this.deathPos.y, this.angle, this.size * (1 + 0.5 * p), true, DEAD_FILL, DEAD_STROKE, true);
				ctx.globalAlpha = 1;
			} else {
				const sinceDeath = now - this.deathStartTime;
				const t = Math.min(1, sinceDeath / DEATH_ANIM_MS);
				const fill = lerpColor(BODY_FILL, DEAD_FILL, t);
				const stroke = lerpColor(BODY_STROKE, DEAD_STROKE, t);
				renderTank(ctx, this, this.deathPos.x, this.deathPos.y, this.angle, this.size, true, fill, stroke, true);
			}
			drawText(
				ctx,
				Math.max(0, remaining / 1000).toFixed(1) + "s",
				this.deathPos.x * sc,
				this.deathPos.y * sc - this.size * sc - 22 * game.scale,
				false, true, true, 24 * game.scale,
			);
			return;
		}
		if (this.spawnStartTime !== null) {
			const sinceSpawn = now - this.spawnStartTime;
			if (sinceSpawn < SPAWN_FADE_MS) {
				// Reverse of corpse fade: start big and faint, settle to normal size and full opacity.
				const p = 1 - sinceSpawn / SPAWN_FADE_MS;
				ctx.globalAlpha = 1 - p;
				renderTank(ctx, this, this.pos.x, this.pos.y, this.angle, this.size * (1 + 0.5 * p), true, BODY_FILL, BODY_STROKE, true);
				ctx.globalAlpha = 1;
				return;
			}
			this.spawnStartTime = null;
		}
		renderTank(ctx, this, this.pos.x, this.pos.y, this.angle, this.size, true, BODY_FILL, BODY_STROKE, true);
	}
}

function drawTankShape(ctx, def, gunStates, cx, cy, angle, sizePx, lineWidth, bodyFill = BODY_FILL, bodyStroke = BODY_STROKE) {
	const cosA = Math.cos(angle);
	const sinA = Math.sin(angle);
	for (let i = 0; i < def.guns.length; ++i) {
		const gun = def.guns[i];
		const gs = gunStates ? gunStates[i] : null;
		const mountX = cx + (gun.x * cosA - gun.y * sinA) * sizePx;
		const mountY = cy + (gun.x * sinA + gun.y * cosA) * sizePx;
		const barrelDir = angle + (gun.angle ?? 0);
		const aspect = gun.aspect ?? 1;
		const halfW = (gun.width / 2) * sizePx;
		const h0 = aspect > 0 ? halfW * aspect : halfW;
		const h1 = aspect > 0 ? halfW : halfW * -aspect;
		const recoilOffset = (gs?.gunPosition ?? 0) * sizePx;
		const barrelLen = gun.length * sizePx;
		ctx.save();
		ctx.translate(mountX, mountY);
		ctx.rotate(barrelDir);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = lineWidth;
		ctx.lineJoin = "round";
		const pts = gun.outline
			? gun.outline.map(([px, py]) => [px * sizePx - recoilOffset, py * sizePx])
			: [
				[-recoilOffset, h1],
				[barrelLen - recoilOffset, h0],
				[barrelLen - recoilOffset, -h0],
				[-recoilOffset, -h1],
			];
		ctx.beginPath();
		for (let p = 0; p < pts.length; p++) {
			if (p === 0) ctx.moveTo(pts[p][0], pts[p][1]);
			else ctx.lineTo(pts[p][0], pts[p][1]);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}
	ctx.fillStyle = bodyFill;
	ctx.strokeStyle = bodyStroke;
	ctx.lineWidth = lineWidth;
	ctx.beginPath();
	ctx.arc(cx, cy, sizePx, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
}

function renderTank(ctx, tank, posX, posY, angle, size, applyRoomFov, bodyFill = BODY_FILL, bodyStroke = BODY_STROKE, skipBullets = false) {
	const sc = applyRoomFov ? game.scale * game.room.fov : game.scale;
	const cx = posX * sc;
	const cy = posY * sc;
	const def = TANK_DEFS[tank.defKey];
	if (applyRoomFov && !skipBullets) {
		for (const b of tank.bullets) b.render(ctx);
	}
	drawTankShape(ctx, def, tank.gunStates, cx, cy, angle, size * sc, 4 * sc, bodyFill, bodyStroke);
	if (applyRoomFov && tank.maxHealth != null && !(tank.isDead && tank.isDead())) {
		drawHealthBar(ctx, cx, cy, size * sc, tank.health, tank.maxHealth, game.scale);
	}
	if (applyRoomFov) {
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

export function renderTankPreview(ctx, tank, x, y, size, angleOverride) {
	const angle = angleOverride ?? -Math.PI / 2;
	const def = TANK_DEFS[tank.defKey];
	drawTankShape(ctx, def, null, x, y, angle, size, size * (4 / 12));
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
		const t = new Tank(new Vec2(cx, cy));
		const saved = state.tanks && state.tanks[game.tanks.length];
		if (saved) {
			if (saved.defKey && TANK_DEFS[saved.defKey]) t.setClass(saved.defKey);
			t.level = saved.level ?? 1;
			t.xp = saved.xp ?? 0;
			t.deduction = saved.deduction ?? 0;
			t.levelUpScore = saved.levelUpScore ?? scoreForLevel(t.level);
			if (saved.pos) { t.pos.x = saved.pos.x; t.pos.y = saved.pos.y; }
			t.recomputeSize();
		}
		game.tanks.push(t);
	}
	while (game.tanks.length > state.tankCount) game.tanks.pop();
}

export function snapshotTanks() {
	state.tanks = game.tanks.map((t) => ({
		defKey: t.defKey,
		level: t.level,
		xp: t.xp,
		deduction: t.deduction,
		levelUpScore: t.levelUpScore,
		pos: { x: t.pos.x, y: t.pos.y },
	}));
}
