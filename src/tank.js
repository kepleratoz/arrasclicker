import { state, playerScoreMul, isRedTeamName } from "./state.js";
import { Vec2, formatNumber, lerpColor, REGEN_PER_FRAME, osaCurve, osaApply } from "./utils.js";
import { game } from "./game.js";
import { mouse, keys } from "./input.js";
import { drawPolygon, drawHealthBar, drawText } from "./render.js";
import { goldTankDamageMul, goldTankReloadMul, goldScoreMul, goldCostReductionMul, grantGoldEffect, gemEffectDurationMs } from "./goldEffects.js";
import { TANK_DEFS } from "./tankDefs.js";

const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
const RED_BODY_FILL = "#e6373d";
const RED_BODY_STROKE = "#7a1c20";
// Resolve the tank/bullet body colours through this so the Red Team easter egg
// just flips a single source of truth.
function teamBodyFill()   { return isRedTeamName() ? RED_BODY_FILL   : BODY_FILL; }
function teamBodyStroke() { return isRedTeamName() ? RED_BODY_STROKE : BODY_STROKE; }
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

// Per-tank upgrade specs (also used by main.js for the per-tank upgrade panel).
// `color` matches the OSA stat-bar palette.
// All caps at 10 to match OSA's stat-bar segment count.
export const TANK_UPGRADE_SPECS = [
	{ key: "hp",          label: "Max Health",      max: 10, baseCost: 100,  growth: 40, color: "#efc74b" },
	{ key: "shieldCap",   label: "Shield Capacity", max: 10, baseCost: 1e12, growth: 2,  color: "#8d6adf" },
	{ key: "shieldRegen", label: "Shield Regen",    max: 10, baseCost: 1e12, growth: 2,  color: "#ef99c3" },
	{ key: "reload",      label: "Reload",          max: 10, baseCost: 1e12, growth: 2,  color: "#b9e87e" },
	{ key: "damage",      label: "Damage",          max: 10, baseCost: 1e12, growth: 2,  color: "#e03e41" },
	{ key: "penetration", label: "Bullet Pen",      max: 10, baseCost: 1e12, growth: 2,  color: "#fdf380" },
	{ key: "bulletHealth",label: "Bullet Health",   max: 10, baseCost: 1e12, growth: 2,  color: "#8abc3f" },
	{ key: "bulletSpeed", label: "Bullet Speed",    max: 10, baseCost: 1e12, growth: 2,  color: "#7ad3db" },
	// Body Damage (atk): tanks don't collide with polygons in this game, so its main effect
	// is feeding into `brst` (which drives RESIST and bullet penetration scaling).
	{ key: "atk",         label: "Body Damage",     max: 10, baseCost: 1e12, growth: 2,  color: "#e7896d" },
	{ key: "speed",       label: "Move Speed",      max: 10, baseCost: 1e14, growth: 2,  color: "#3ca4cb" },
];
export function tankUpgradeCost(spec, level) { return Math.round(spec.baseCost * Math.pow(spec.growth, level) * goldCostReductionMul()); }
// Total skill points spent across every per-tank upgrade.
export function tankSkillPointsSpent(tank) {
	let n = 0;
	for (const spec of TANK_UPGRADE_SPECS) n += tank.upgrades?.[spec.key] ?? 0;
	return n;
}
// Cap is min(42, tank.level): a tank can never exceed 42 invested points, and below
// level 42 the cap is the tank's own level — one point per level matches OSA's flow.
export function tankSkillPointsCap(tank) { return Math.min(42, Math.max(0, tank.level | 0)); }
export function tankSkillPointsRemaining(tank) {
	return Math.max(0, tankSkillPointsCap(tank) - tankSkillPointsSpent(tank));
}
function defaultUpgrades() {
	const o = {};
	for (const spec of TANK_UPGRADE_SPECS) o[spec.key] = 0;
	return o;
}
function up(tank, key) { return tank?.upgrades?.[key] ?? 0; }

// OSA-style stat conversion (skills.js): each upgrade level passes through the curve,
// then through `apply(f, attrib)` which is f·attrib + 1 for positive attrib.
// Caps derived from TANK_UPGRADE_SPECS so the curve's level/cap ratio always matches
// the actual upgrade max — avoids drift if specs are rebalanced later.
const TANK_SKILL_CAPS = Object.fromEntries(TANK_UPGRADE_SPECS.map(s => [s.key, s.max]));
function tankSkill(tank, key) { return osaCurve(up(tank, key), TANK_SKILL_CAPS[key] ?? 10); }
function tankShootInterval(tank) { return BASE_SHOOT_INTERVAL * Math.pow(0.5, tankSkill(tank, "reload")) * goldTankReloadMul(); }
export function tankCanTarget(shape) {
	if (shape.isGold) return false;
	if (shape.isGem) return false;     // gems are debug-spawned curiosities, not valid targets.
	if (shape.neutral) return false;   // neutral sentries / sanctuaries are landmarks, never targeted.
	// Two independent gates:
	//   • Rarity cap (`state.tankRarityCap`): blocks high-rarity shapes the player wants
	//     to leave alone (e.g. "don't target Legendaries and above").
	//   • Force-type cap (`state.tankForceTypeCap`, -1 = off): unconditionally allows
	//     any shape up to that type, overriding the rarity gate.
	if ((state.tankForceTypeCap ?? -1) >= 0 && shape.type <= state.tankForceTypeCap) return true;
	// Force-target tier: any shape whose tier (layers) has reached the chosen
	// threshold gets auto-targeted regardless of the rarity cap.
	if ((state.tankForceTierCap ?? -1) >= 1 && (shape.layers ?? 1) >= state.tankForceTierCap) return true;
	return shape.rarity < state.tankRarityCap - 1;
}
function tankCanLockOn(shape) { return tankCanTarget(shape) && shape.rarity !== 4; }
function tankDamageMul(shape) { return shape.rarity === 4 ? 0.1 : 1; }
function tankBaseDamage(tank) { return osaApply(3, tankSkill(tank, "damage")) * goldTankDamageMul(); }
function tankBulletLife() { return BASE_BULLET_LIFE; }
// Effective weapon range in world units. For drone tanks (Director-style: any
// gun with shoot.isDrone) we use the Basic tank's projectile range × 3, since
// drones don't expire from age and their roaming radius isn't a bullet-life
// formula. Other tanks return the maximum (speed × life) across their guns.
function tankRange(tank) {
	const def = TANK_DEFS[tank.defKey];
	if (!def || !def.guns) return BULLET_SPEED * BASE_BULLET_LIFE;
	let hasDrone = false;
	let best = 0;
	for (const gun of def.guns) {
		if (!gun.shoot) continue;
		if (gun.shoot.isDrone) { hasDrone = true; continue; }
		const speedMul = gun.shoot.speed ?? 1;
		const rangeMul = gun.shoot.range ?? 1;
		const isTrap = !!gun.shoot.isTrap;
		const upgradeSpeedMul = gun.shoot.ignoreUpgradeSpeed
			? 1
			: isTrap ? 1 + (tankBulletSpeedMul(tank) - 1) * 0.5 : tankBulletSpeedMul(tank);
		const speed = BULLET_SPEED * speedMul * upgradeSpeedMul;
		const life = BASE_BULLET_LIFE * rangeMul * (isTrap ? 3 : 1);
		best = Math.max(best, speed * life);
	}
	if (hasDrone) {
		const basicRange = BULLET_SPEED * tankBulletSpeedMul(tank) * BASE_BULLET_LIFE;
		return Math.max(best, basicRange * 3);
	}
	return best || BULLET_SPEED * BASE_BULLET_LIFE;
}
function tankBulletHealth(tank) { return 5 * osaApply(2, tankSkill(tank, "bulletHealth")); }
function tankSpeed(tank) { return BASE_TANK_SPEED * osaApply(0.8, tankSkill(tank, "speed")); }
function tankBulletSpeedMul(tank) { return osaApply(1.5, tankSkill(tank, "bulletSpeed")); }
function tankBulletPen(tank) { return osaApply(2.5, tankSkill(tank, "penetration")); }
function tankAtkSkill(tank) { return osaApply(0.021, tankSkill(tank, "atk")); }
function tankHltSkill(tank) { return osaApply(1, tankSkill(tank, "hp")); }
function tankRgnSkill(tank) { return osaApply(25, tankSkill(tank, "shieldRegen")); }
function tankBurst(tank) { return 0.3 * (0.5 * tankAtkSkill(tank) + 0.5 * tankHltSkill(tank) + tankRgnSkill(tank)); }
function tankResist(tank) { const RESIST = 0; return 1 - 1 / Math.max(1, RESIST + tankBurst(tank)); }
function tankMaxHealth(tank) { return 10 * osaApply(1, tankSkill(tank, "hp")); }
function tankMaxShield(tank) { return 5 * osaApply(2, tankSkill(tank, "shieldCap")); }
// Base 0.167 HP/sec at the bell's peak ≈ OSA's cons·REGEN·10/3 = 5·0.01·10/3 ≈ 0.167.
// Maxed (skill ×26) → ~4.3 HP/sec at peak. Was 0.4 — 4× too tanky against sustained fire.
function tankShieldRegenRate(tank) { return 0.167 * osaApply(25, tankSkill(tank, "shieldRegen")); }
// OSA has no explicit cooldown; the bell curve does the work at r→0. But sustained-damage
// scenarios out-resolve the curve at mid-shield, so we hold regen for a short window after
// each hit so shield breaks are actually felt.
const SHIELD_REGEN_DELAY_MS = 1200;
// OSA-style health regen: only ticks when shield is at max ("rest" mechanic).
// 25 HP/s when shielded comes from healthType.js: cons(5) × boost(0.5) per 100ms tick × 10 = 25/s.
const HEALTH_REGEN_PER_SEC_SHIELDED = 25;
// OSA collision damage: every overlapping frame, both sides take symmetric damage scaled by
// ratio (low-HP → less damage, modulated by penetration), the depth-based "damage effects"
// term (bullets sinking deeper deal less per frame and take less back), the speed factor
// (capped 2× for fast attackers), and the death factor (overkill prevention — if either
// side would die, the other only delivers a proportional share of damage).
function osaCollideDamage(bullet, target, dx, dy, dist, combinedRadius) {
	const depthBullet = Math.max(0, Math.min(1, (combinedRadius - dist) / (2 * Math.max(0.01, bullet.size))));
	const depthTarget = Math.max(0, Math.min(1, (combinedRadius - dist) / (2 * Math.max(0.01, target.size))));
	const accelFactor = (combinedRadius / 4) / (Math.floor(combinedRadius / dist) + 1);
	const dirX = dx / dist;
	const dirY = dy / dist;
	const vlen = Math.max(0.001, Math.sqrt(bullet.velocity.x * bullet.velocity.x + bullet.velocity.y * bullet.velocity.y));
	const component = Math.max(0, bullet.velocity.x * dirX + bullet.velocity.y * dirY);
	const componentNorm = component / vlen;
	const bulletPen = Math.max(0.1, bullet.penetration ?? 1);
	const targetPen = Math.max(0.1, target.penetration ?? 1);
	const penTargetSqrt = Math.sqrt(targetPen);
	const penBulletSqrt = Math.sqrt(bulletPen);
	const speedFactor = bullet.maxSpeed ? Math.pow(vlen / bullet.maxSpeed, 0.25) : 1;
	const speedMul = Math.min(2, Math.max(speedFactor, 1) * speedFactor);
	const buffMul = (bullet.buffVsFood && target.damageType === 1) ? 3 : 1;
	// OSA resistDiff: higher-resist attacker deals more, takes less. resist ∈ [0, ~0.88].
	const resistDiff = (bullet.resist ?? 0) - (target.resist ?? 0);
	let dmgToTarget = bullet.damage * buffMul * speedMul * tankDamageMul(target) * (1 + resistDiff);
	let dmgToBullet = (target.damage ?? 0) * (1 - resistDiff);
	// Ratio damage: wounded attackers deal less, modulated by their pen.
	if (target.maxHealth > 0) {
		const r = Math.max(0.0001, target.health / target.maxHealth);
		dmgToBullet *= Math.min(1, Math.pow(r, 1 / targetPen));
	}
	if (bullet.maxHealth > 0) {
		const r = Math.max(0.0001, bullet.health / bullet.maxHealth);
		dmgToTarget *= Math.min(1, Math.pow(r, 1 / bulletPen));
	}
	// Damage-effects: depth + pen-vs-pen scaling per frame (the "sinking in" curve).
	dmgToTarget *= accelFactor *
		(1 + (componentNorm - 1) * (1 - depthTarget) / bulletPen) *
		(1 + penTargetSqrt * depthTarget - depthTarget) / penTargetSqrt;
	dmgToBullet *= accelFactor *
		(1 + (componentNorm - 1) * (1 - depthBullet) / targetPen) *
		(1 + penBulletSqrt * depthBullet - depthBullet) / penBulletSqrt;
	dmgToTarget = Math.max(0, dmgToTarget);
	dmgToBullet = Math.max(0, dmgToBullet);
	// Death factor: scale the survivor's damage taken when the dying side can't fully connect.
	const deathFactorBullet = (dmgToBullet > bullet.health) ? bullet.health / dmgToBullet : 1;
	const deathFactorTarget = (dmgToTarget > target.health) ? target.health / dmgToTarget : 1;
	return { toTarget: dmgToTarget * deathFactorBullet, toBullet: dmgToBullet * deathFactorTarget };
}

const DEATH_FRAMES = 18; // ~300ms at 60fps to match OSA's getFade decay

// Walls are session-only axis-aligned squares (debug map editor). Helpers below
// return whether `pos` (a circle of `radius`) overlaps any wall, and push the
// circle out of every wall it overlaps.
export function overlapsWall(pos, radius) {
	for (const w of game.walls) {
		const half = w.size / 2;
		const dx = pos.x - w.x;
		const dy = pos.y - w.y;
		const ox = dx - Math.max(-half, Math.min(half, dx));
		const oy = dy - Math.max(-half, Math.min(half, dy));
		if (ox * ox + oy * oy < radius * radius) return true;
	}
	return false;
}
export function pushOutOfWalls(pos, radius) {
	for (const w of game.walls) {
		const half = w.size / 2;
		const dx = pos.x - w.x;
		const dy = pos.y - w.y;
		const cx = Math.max(-half, Math.min(half, dx));
		const cy = Math.max(-half, Math.min(half, dy));
		const ox = dx - cx;
		const oy = dy - cy;
		const distSq = ox * ox + oy * oy;
		if (distSq === 0) {
			// Center is inside the rectangle — push out along the shortest axis.
			const px = half + radius - Math.abs(dx);
			const py = half + radius - Math.abs(dy);
			if (px < py) pos.x += (dx >= 0 ? 1 : -1) * px;
			else pos.y += (dy >= 0 ? 1 : -1) * py;
		} else if (distSq < radius * radius) {
			const dist = Math.sqrt(distSq);
			const push = (radius - dist) / dist;
			pos.x += ox * push;
			pos.y += oy * push;
		}
	}
}

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
			: this.isTrap ? 1 + (tankBulletSpeedMul(tank) - 1) * 0.5 : tankBulletSpeedMul(tank);
		this.maxSpeed = BULLET_SPEED * speedMul * upgradeSpeedMul;
		this.velocity = Vec2.circle(angle, this.maxSpeed * shudderMul);
		this.size = sizeOverride ?? (tank.size * gunWidth * sizeMul) / 2;
		this.tank = tank;
		this.life = tankBulletLife() * rangeMul * (this.isTrap ? 3 : 1);
		this.damage = (shootCfg.ignoreUpgradeDamage ? 1 : tankBaseDamage(tank)) * damageMul;
		this.penetration = (shootCfg.penetration ?? tankBulletPen(tank));
		// Bullets inherit the firing entity's resist. For Tanks (which have an upgrade
		// track), recompute from skill. For Sanctuary / Sentry (no upgrade track but a
		// hardcoded `resist` field), use that directly — otherwise default to 0.
		this.resist = tank?.upgrades ? tankResist(tank) : (tank?.resist ?? 0);
		this.health = (shootCfg.ignoreUpgradeHealth ? 5 : tankBulletHealth(tank)) * healthMul;
		this.maxHealth = this.health;
		this.isHeal = !!shootCfg.isHeal;
		this.isSentryHeal = !!shootCfg.sentryHeal;
		this.healAmount = shootCfg.healAmount ?? 0;
		this.targetsTanks = !!shootCfg.targetsTanks;
		this.ignoreFood = !!shootCfg.ignoreFood;   // pass through `damageType === 1` shapes (polygons).
		this.isDrone = !!shootCfg.isDrone;
		if (this.isDrone) {
			this.life = Infinity;                  // drones don't expire from age.
			this.droneMaxSpeed = shootCfg.droneMaxSpeed ?? 3;
			this.droneAccel = shootCfg.droneAccel ?? 0.12;
			this.droneRange = shootCfg.droneRange ?? 600;
			this.droneOrbitRadius = shootCfg.droneOrbitRadius ?? 60;     // tight halo around master.
			this.droneOrbitSpeed = shootCfg.droneOrbitSpeed ?? 1.5;
			this.orbitDir = Math.random() < 0.5 ? 1 : -1;  // CW/CCW around master at random.
		}
		// OSA's `buffVsFood`: ×3 damage to entities tagged as food (damageType === 1).
		// Inherited from the shooter so all tank-fired bullets get it automatically.
		this.buffVsFood = !!(shootCfg.buffVsFood || (tank && tank.buffVsFood));
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
		if (this.isDrone) {
			const masterAlive = this.tank && !(this.tank.isDead && this.tank.isDead());
			const cmd = this.tank?.droneControl;
			// Manual drone command (controlled Director): attract/repel from cursor.
			if (cmd && cmd.mode === "attract") {
				const ax = cmd.x - this.pos.x;
				const ay = cmd.y - this.pos.y;
				const targetAngle = Math.atan2(ay, ax);
				let delta = targetAngle - this.angle;
				while (delta > Math.PI) delta -= Math.PI * 2;
				while (delta < -Math.PI) delta += Math.PI * 2;
				this.angle += Math.max(-MAX_TURN_PER_FRAME, Math.min(MAX_TURN_PER_FRAME, delta));
				this.velocity.x += Math.cos(this.angle) * this.droneAccel;
				this.velocity.y += Math.sin(this.angle) * this.droneAccel;
			} else if (cmd && cmd.mode === "repel") {
				const dx = this.pos.x - cmd.x;
				const dy = this.pos.y - cmd.y;
				const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
				// Stronger push close, falls off past 400 units.
				const falloff = Math.max(0, 1 - dist / 400);
				const accelMul = (1 + falloff * 1.5);
				const fleeAngle = Math.atan2(dy, dx);
				let delta = fleeAngle - this.angle;
				while (delta > Math.PI) delta -= Math.PI * 2;
				while (delta < -Math.PI) delta += Math.PI * 2;
				this.angle += Math.max(-MAX_TURN_PER_FRAME, Math.min(MAX_TURN_PER_FRAME, delta));
				this.velocity.x += Math.cos(this.angle) * this.droneAccel * accelMul;
				this.velocity.y += Math.sin(this.angle) * this.droneAccel * accelMul;
			} else {
			// Inherit target from the master — drones chase whatever the Director is locked on to.
			const target = (this.tank && this.tank.target && !this.tank.target.isDead()) ? this.tank.target : null;
			if (target) {
				// Chase mode: smoothToTarget turn, then accelerate along the drone's facing.
				const ax = target.pos.x - this.pos.x;
				const ay = target.pos.y - this.pos.y;
				const targetAngle = Math.atan2(ay, ax);
				let delta = targetAngle - this.angle;
				while (delta > Math.PI) delta -= Math.PI * 2;
				while (delta < -Math.PI) delta += Math.PI * 2;
				this.angle += Math.max(-MAX_TURN_PER_FRAME, Math.min(MAX_TURN_PER_FRAME, delta));
				this.velocity.x += Math.cos(this.angle) * this.droneAccel;
				this.velocity.y += Math.sin(this.angle) * this.droneAccel;
			} else if (masterAlive) {
				// OSA "hangOutAroundMaster": orbit the Director at droneOrbitRadius.
				const dx = this.pos.x - this.tank.pos.x;
				const dy = this.pos.y - this.tank.pos.y;
				const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
				const radialError = dist - this.droneOrbitRadius;
				const tanX = -dy / dist * this.orbitDir;
				const tanY = dx / dist * this.orbitDir;
				const radX = -dx / dist;
				const radY = -dy / dist;
				const desiredVx = tanX * this.droneOrbitSpeed + radX * radialError * 0.05;
				const desiredVy = tanY * this.droneOrbitSpeed + radY * radialError * 0.05;
				// Steer velocity toward the desired orbit velocity instead of snapping,
				// so the entry into orbit looks smooth.
				this.velocity.x += (desiredVx - this.velocity.x) * 0.2;
				this.velocity.y += (desiredVy - this.velocity.y) * 0.2;
				// Smooth-turn the body to face the orbit-tangent direction.
				const orbitAngle = Math.atan2(desiredVy, desiredVx);
				let delta = orbitAngle - this.angle;
				while (delta > Math.PI) delta -= Math.PI * 2;
				while (delta < -Math.PI) delta += Math.PI * 2;
				this.angle += Math.max(-MAX_TURN_PER_FRAME, Math.min(MAX_TURN_PER_FRAME, delta));
			}
			}  // end of manual-cmd `else` branch (auto target/orbit).
			// Push apart from other drones so they don't stack on the same target.
			if (this.tank && this.tank.bullets) {
				for (const other of this.tank.bullets) {
					if (other === this || !other.isDrone || other.dying) continue;
					const dx = this.pos.x - other.pos.x;
					const dy = this.pos.y - other.pos.y;
					const distSq = dx * dx + dy * dy;
					const minDist = this.size + other.size;
					if (distSq < minDist * minDist && distSq > 0.001) {
						const dist = Math.sqrt(distSq);
						const overlap = (minDist - dist) / dist;
						this.velocity.x += dx * overlap * 0.25;
						this.velocity.y += dy * overlap * 0.25;
					}
				}
			}
			const sp = this.velocity.length();
			if (sp > this.droneMaxSpeed) this.velocity.mulVal(this.droneMaxSpeed / sp);
		}
		this.pos.add(this.velocity);
		// Bullets, drones, and traps all die on contact with a wall.
		if (!this.dying && overlapsWall(this.pos, this.size)) {
			this.startDying();
			return;
		}
		if (this.isTrap) {
			this.velocity.mulVal(0.97);
			this.angle += this.velocity.length() * 0.04;
		} else if (this.isDrone) {
			// Drones are repelled from the arena edge — same logic shapes/tanks use.
			const edgeForce = game.room.applyForce(this.pos, this.size, 0.05);
			this.pos.add(edgeForce);
			this.velocity.mulVal(0.95);    // stronger friction so drones don't drift far after losing target.
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
		if (this.targetsTanks) {
			// Tanks first — OSA continuous multihit, damage routed through shield → health.
			for (const t of game.tanks) {
				if (t.isDead && t.isDead()) continue;
				const dx = t.pos.x - this.pos.x;
				const dy = t.pos.y - this.pos.y;
				const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
				const combinedRadius = t.size + this.size;
				if (dist >= combinedRadius) continue;
				const result = osaCollideDamage(this, t, dx, dy, dist, combinedRadius);
				if (result.toTarget > 0) t.takeDamage(result.toTarget);
				this.health -= result.toBullet;
				if (this.health <= 0) { this.startDying(); return; }
				break;
			}
			// Sanctuaries are also valid friendly targets for enemy bullets.
			if (!this.dying) {
				for (const sg of game.sieges) {
					if (sg.health <= 0) continue;
					const dx = sg.pos.x - this.pos.x;
					const dy = sg.pos.y - this.pos.y;
					const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
					const combinedRadius = sg.size + this.size;
					if (dist >= combinedRadius) continue;
					const result = osaCollideDamage(this, sg, dx, dy, dist, combinedRadius);
					if (result.toTarget > 0) sg.takeDamage(result.toTarget);
					this.health -= result.toBullet;
					if (this.health <= 0) { this.startDying(); return; }
					break;
				}
			}
			return;
		}
		if (this.isSentryHeal) {
			// Pink heal bullet for the Sentry Spawner. Restores HP on contact with
			// any non-dying Sentry below max health, then expires. Doesn't damage
			// anything; just falls through to standard flight otherwise.
			for (const sh of game.shapes) {
				if (!sh.isSentry || (sh.isDead && sh.isDead())) continue;
				if (sh.health >= sh.maxHealth) continue;
				const dx = sh.pos.x - this.pos.x;
				const dy = sh.pos.y - this.pos.y;
				if (Math.sqrt(dx * dx + dy * dy) < sh.size + this.size) {
					sh.health = Math.min(sh.maxHealth, sh.health + this.healAmount);
					this.startDying();
					return;
				}
			}
			return;
		}
		if (this.isHeal) {
			// Heal bullets behave like normal bullets, except: on contact with a tank
			// that has anything to top up (shield or health) they restore one or the
			// other and instantly break. Shield is healed first when it's missing —
			// it tends to absorb the bulk of incoming damage.
			for (const t of game.tanks) {
				if (t.isDead && t.isDead()) continue;
				const shieldMissing = (t.maxShield ?? 0) > 0 && (t.shield ?? 0) < t.maxShield;
				const healthMissing = t.health < t.maxHealth;
				if (!shieldMissing && !healthMissing) continue;
				const dx = t.pos.x - this.pos.x;
				const dy = t.pos.y - this.pos.y;
				if (Math.sqrt(dx * dx + dy * dy) < t.size + this.size) {
					if (shieldMissing) t.shield = Math.min(t.maxShield, (t.shield ?? 0) + this.healAmount);
					else t.health = Math.min(t.maxHealth, t.health + this.healAmount);
					this.startDying();
					return;
				}
			}
			// fall through to the standard shape collision loop below.
		}
		// OSA-style continuous multihit: every frame the bullet overlaps a target both sides
		// take symmetric damage, scaled by ratio/pen/depth/speed/death-factor. No cooldown —
		// the depth term naturally tapers each frame's damage as the bullet sinks in.
		for (const shape of game.shapes) {
			if (shape.isDead()) continue;
			// Priority shapes are excluded from active targeting but still take
			// incidental bullet damage, so bypass the tankCanTarget gate for them.
			if (shape !== game.priorityTarget && !tankCanTarget(shape)) continue;
			if (this.ignoreFood && shape.damageType === 1) continue;
			const dx = shape.pos.x - this.pos.x;
			const dy = shape.pos.y - this.pos.y;
			const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
			const combinedRadius = shape.size + this.size;
			if (dist >= combinedRadius) continue;
			const result = osaCollideDamage(this, shape, dx, dy, dist, combinedRadius);
			shape.health -= result.toTarget;
			this.health -= result.toBullet;
			if (result.toTarget > 0) { shape.damageBlend = 1; shape.touchedByTank = true; }
			if (shape.health <= 0 && !shape.dying) {
				if (shape.isGold) grantGoldEffect(shape.type);
				else if (shape.isGem) grantGoldEffect(shape.type, gemEffectDurationMs());
				shape.startDying();
				const gained = Math.round(shape.score * goldScoreMul() * playerScoreMul());
				state.score += gained;
				const sc = game.scale * game.room.fov;
				game.flyingText.push({
					x: shape.pos.x * sc,
					y: shape.pos.y * sc,
					alpha: 1,
					text: "+" + formatNumber(gained),
				});
				if (this.tank && typeof this.tank.gainXp === "function") this.tank.gainXp(getJackpot(shapeXpValue(shape)));
			}
			if (this.health <= 0) { this.startDying(); return; }
			break;
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const fade = this.dying ? Math.max(0, 1 - this.dying / DEATH_FRAMES) : 1;
		const sizeMul = 1 + 0.5 * (1 - fade);
		ctx.globalAlpha = fade;
		// Sentry-fired bullets — and the Sentry Spawner's heal bullets — render
		// pink to match the triangle that shot them.
		if (this.targetsTanks || this.isSentryHeal) {
			ctx.fillStyle = "#ef99c3";
			ctx.strokeStyle = "#a55c83";
		} else {
			ctx.fillStyle = teamBodyFill();
			ctx.strokeStyle = teamBodyStroke();
		}
		ctx.lineWidth = 4 * sc;
		if (this.isTrap) {
			drawTrap(ctx, this.pos.x * sc, this.pos.y * sc, this.size * sizeMul * sc, this.angle);
		} else if (this.isDrone) {
			// OSA Class.drone SHAPE = 3 (triangle), oriented along motion.
			drawPolygon(ctx, this.pos.x, this.pos.y, this.size * sizeMul, this.angle, 3);
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
const MAX_TANKS_PER_TARGET = 2;   // how many tanks may lock onto the same mob.
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
		this.upgrades = defaultUpgrades();
		// buffVsFood machinery (Bullet.buffVsFood check, Shape.damageType tagging) is kept
		// for future use. Disabled on tanks for now so polygon damage isn't auto-tripled.
		this.buffVsFood = false;
		this.maxHealth = tankMaxHealth(this);
		this.health = this.maxHealth;
		this.maxShield = tankMaxShield(this);
		this.shield = this.maxShield;
		this.lastDamageTime = 0;     // performance.now() of last incoming damage; gates shield regen.
		this.respawnAt = null;       // performance.now() timestamp; null while alive.
		this.deathPos = null;
		this.deathStartTime = null;  // when current death animation started.
		this.spawnStartTime = null;  // when current spawn animation started.
		this.damageBlend = 0;        // OSA-style red-flash on damage; decays per frame.
	}
	isDead() { return this.respawnAt !== null; }
	die() {
		state.statTankDeaths++;
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
		this.maxHealth = tankMaxHealth(this);
		this.health = this.maxHealth;
		this.maxShield = tankMaxShield(this);
		this.shield = this.maxShield;
		this.lastDamageTime = 0;
		this.velocity = new Vec2();
		this.respawnAt = null;
		this.deathPos = null;
		this.deathStartTime = null;
		this.spawnStartTime = performance.now();
	}
	syncMaxHealth() {
		const newMax = tankMaxHealth(this);
		if (newMax !== this.maxHealth) {
			const ratio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
			this.maxHealth = newMax;
			this.health = newMax * ratio;
		}
		const newMaxShield = tankMaxShield(this);
		if (newMaxShield !== this.maxShield) {
			const r = this.maxShield > 0 ? this.shield / this.maxShield : 1;
			this.maxShield = newMaxShield;
			this.shield = newMaxShield * r;
		}
	}
	// OSA dynamic-shield regen (healthType.js → "dynamic" branch). The bell-curve
	// `regenMultiplier` peaks at ~32% shield and drops off near 0 and full, so a fully-
	// drained shield refills slowly at first. Plus a linear floor proportional to current
	// shield so it doesn't stall completely. No post-damage delay (matches OSA).
	tickShieldRegen() {
		if (this.maxShield <= 0 || this.shield >= this.maxShield) return;
		if (performance.now() - this.lastDamageTime < SHIELD_REGEN_DELAY_MS) return;
		const r = this.shield / this.maxShield;
		const regenMul = Math.exp(-50 * Math.pow(Math.sqrt(r / 2) - 0.4, 2));
		const skillRate = tankShieldRegenRate(this);     // HP/sec at the bell-curve peak.
		// Was r·max/3; dropped to /15 so the floor doesn't dominate mid-shield against light damage.
		const linearFloor = (r * this.maxShield) / 15;
		const perSec = skillRate * regenMul + linearFloor;
		this.shield = Math.min(this.maxShield, this.shield + perSec / 60);
	}
	// OSA static-health regen: only heals when shield is at max ("rest" mechanic).
	tickHealthRegen() {
		if (this.health >= this.maxHealth) return;
		const shieldFull = this.maxShield > 0 && this.shield >= this.maxShield;
		if (!shieldFull) return;
		this.health = Math.min(this.maxHealth, this.health + HEALTH_REGEN_PER_SEC_SHIELDED / 60);
	}
	takeDamage(n) {
		if (this.isDead()) return;
		this.lastDamageTime = performance.now();
		this.damageBlend = 1;
		if (this.shield > 0) {
			const absorbed = Math.min(this.shield, n);
			this.shield -= absorbed;
			n -= absorbed;
		}
		if (n <= 0) return;
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
	maxOutLevel() {
		this.level = 42;
		this.xp = 0;
		this.deduction = 0;
		this.levelUpScore = scoreForLevel(43);
		this.recomputeSize();
		this.maxHealth = tankMaxHealth(this);
		this.health = this.maxHealth;
		this.maxShield = tankMaxShield(this);
		this.shield = this.maxShield;
	}
	reviveImmediately() {
		if (this.isDead()) this.respawn();
	}
	resetUpgrades() {
		this.upgrades = defaultUpgrades();
		this.maxHealth = tankMaxHealth(this);
		this.health = Math.min(this.health, this.maxHealth);
		this.maxShield = tankMaxShield(this);
		this.shield = Math.min(this.shield, this.maxShield);
	}
	// `claimCounts` is a Map<shape, number> of how many tanks already target each shape.
	// Up to MAX_TANKS_PER_TARGET tanks may share one mob.
	findNearest(claimCounts) {
		// Shift-click priority target overrides EVERY targeting filter — the
		// rarity cap, force-type cap, gem/gold/ethereal lock-on exclusions,
		// claim caps, and any current target. Returned unconditionally so the
		// tank detaches from whatever it was already chasing on the next tick.
		// Clears itself if the priority dies or leaves game.shapes.
		const priority = game.priorityTarget;
		if (priority && game.shapes.includes(priority) && !(priority.isDead && priority.isDead())) {
			return priority;
		}
		if (priority) game.priorityTarget = null;
		// Mobs (Sentries / Sentry Sanctuaries) take priority over polygons. We
		// pick the nearest mob if any are available; otherwise fall back to the
		// nearest polygon. Lock-on / claim caps apply to both pools.
		let bestMob = null, bestMobD = Infinity;
		let bestShape = null, bestShapeD = Infinity;
		for (const sh of game.shapes) {
			if (sh.isDead() || !tankCanLockOn(sh)) continue;
			const isMob = sh.isSentry || sh.isSentrySpawner;
			// Mobs allow unlimited concurrent attackers; polygons still respect the cap.
			if (!isMob && (claimCounts.get(sh) ?? 0) >= MAX_TANKS_PER_TARGET) continue;
			const dx = sh.pos.x - this.pos.x;
			const dy = sh.pos.y - this.pos.y;
			const d = dx * dx + dy * dy;
			if (isMob) {
				if (d < bestMobD) { bestMob = sh; bestMobD = d; }
			} else if (d < bestShapeD) {
				bestShape = sh; bestShapeD = d;
			}
		}
		return bestMob || bestShape;
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
		this.resist = tankResist(this);     // OSA resist = 1 - 1/max(1, RESIST + brst).
		// Body damage and penetration so incoming bullets can compute the OSA formula
		// against this tank as a target. We don't add tank-vs-shape physical collision.
		const atkSk = tankAtkSkill(this);
		const brst = tankBurst(this);
		this.damage = atkSk;                // base tank body damage = 1 × atk skill.
		this.penetration = 1 + 1.5 * (brst + 0.8 * (atkSk - 1));
		this.damageBlend *= 0.85;           // OSA-style hit-flash decay.
		if (this.damageBlend < 0.01) this.damageBlend = 0;
		this.tickShieldRegen();
		this.tickHealthRegen();
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
			const speed = tankSpeed(this);
			if (len > 0) {
				this.velocity.x = (dx / len) * speed;
				this.velocity.y = (dy / len) * speed;
			} else {
				this.velocity.mulVal(0.5);
			}
			this.target = null;
			target = mouse.left ? this : null;
			// Drone-command override (Director): left = attract, right = repel, else auto.
			if (mouse.left) this.droneControl = { mode: "attract", x: mouseWorldX, y: mouseWorldY };
			else if (mouse.right) this.droneControl = { mode: "repel", x: mouseWorldX, y: mouseWorldY };
			else this.droneControl = null;
		} else {
			this.droneControl = null;
			const claimCounts = new Map();
			for (const t of game.tanks) {
				if (t === this) break;
				if (t.target && !t.target.isDead()) claimCounts.set(t.target, (claimCounts.get(t.target) ?? 0) + 1);
			}
			target = this.findNearest(claimCounts);
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
				const def = TANK_DEFS[this.defKey];
				// Keep-out distance: for mobs, hover at ~50% of the tank's own weapon
				// range so it shoots but doesn't body-rush. Drone tanks (Director)
				// get 3× the basic-tank range. Non-mob targets use the tank's def
				// keepout (defaults to 30).
				const isMobTarget = !!(target.isSentry || target.isSentrySpawner);
				const keepout = isMobTarget ? tankRange(this) * 0.5 - (target.size + this.size) : (def.keepout ?? 30);
				const desired = Math.max(60, target.size + this.size + keepout);
				const speed = tankSpeed(this);
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
		pushOutOfWalls(this.pos, this.size);
		this.velocity.mulVal(0.92);
		// Body damage from mobs: if a tank's body overlaps a Sentry or Sentry
		// Sanctuary, both sides take symmetric OSA-style damage every frame the
		// overlap persists. Tanks also get pushed out so they don't stick.
		for (const sh of game.shapes) {
			if (!(sh.isSentry || sh.isSentrySpawner)) continue;
			if (sh.isDead && sh.isDead()) continue;
			const dx = sh.pos.x - this.pos.x;
			const dy = sh.pos.y - this.pos.y;
			const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
			const combinedRadius = sh.size + this.size;
			if (dist >= combinedRadius) continue;
			// Treat mob as "bullet" / tank as "target": toTarget hits the tank, toBullet hits the mob.
			const result = osaCollideDamage(sh, this, -dx, -dy, dist, combinedRadius);
			// Route through takeDamage so the tank actually dies + shield is consumed.
			if (result.toTarget > 0) this.takeDamage(result.toTarget);
			sh.health -= result.toBullet;
			sh.damageBlend = 1;
			if (sh.health <= 0 && !sh.dying && sh.startDying) sh.startDying();
			if (this.isDead()) return;
			// Push the tank away so it can't park inside the mob.
			const overlap = combinedRadius - dist;
			this.pos.x -= (dx / dist) * overlap * 0.6;
			this.pos.y -= (dy / dist) * overlap * 0.6;
		}
		// Push apart from other live tanks so they don't stack. Each side moves half
		// the overlap; both tanks run this loop, giving full separation per frame.
		for (const other of game.tanks) {
			if (other === this || (other.isDead && other.isDead())) continue;
			const dx = this.pos.x - other.pos.x;
			const dy = this.pos.y - other.pos.y;
			const distSq = dx * dx + dy * dy;
			const minDist = this.size + other.size;
			if (distSq < minDist * minDist && distSq > 0.001) {
				const dist = Math.sqrt(distSq);
				const overlap = minDist - dist;
				this.pos.x += (dx / dist) * overlap * 0.5;
				this.pos.y += (dy / dist) * overlap * 0.5;
			}
		}
		for (let i = this.bullets.length - 1; i >= 0; --i) {
			this.bullets[i].update();
			if (this.bullets[i].dead) this.bullets.splice(i, 1);
		}
	}
	_fireGun(gun, gs, now, interval) {
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
	shootGuns(target) {
		const def = TANK_DEFS[this.defKey];
		const now = performance.now();
		for (let i = 0; i < def.guns.length; ++i) {
			const gun = def.guns[i];
			const gs = this.gunStates[i];
			if (gun.shoot) {
				const reloadMul = gun.shoot.reload ?? 1;
				const interval = tankShootInterval(this) * reloadMul;
				if (!gs.delayInitialized) {
					gs.shootTime = now + gs.initialDelay * interval;
					gs.delayInitialized = true;
				}
				// AutoFire guns (OSA AUTOFIRE: true, used by Director) fire without a target.
				const canFire = target || gun.shoot.autoFire;
				if (canFire && now > gs.shootTime) {
					// Drone-spawning guns are capped at maxChildren — OSA WAIT_TO_CYCLE: true,
					// the reload pauses until a drone dies, so don't advance shootTime here.
					if (gun.shoot.isDrone && gun.shoot.maxChildren != null) {
						let count = 0;
						for (const b of this.bullets) if (b.isDrone) count++;
						if (count >= gun.shoot.maxChildren) {
							// no-op: skip shooting and don't reset shootTime.
						} else {
							this._fireGun(gun, gs, now, interval);
						}
					} else {
						this._fireGun(gun, gs, now, interval);
					}
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
				const fill = lerpColor(teamBodyFill(), DEAD_FILL, t);
				const stroke = lerpColor(teamBodyStroke(), DEAD_STROKE, t);
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
				renderTank(ctx, this, this.pos.x, this.pos.y, this.angle, this.size * (1 + 0.5 * p), true, teamBodyFill(), teamBodyStroke(), true);
				ctx.globalAlpha = 1;
				return;
			}
			this.spawnStartTime = null;
		}
		renderTank(ctx, this, this.pos.x, this.pos.y, this.angle, this.size, true, teamBodyFill(), teamBodyStroke(), true);
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
	const blend = state.damageBlendEnabled ? (tank.damageBlend ?? 0) * 0.5 : 0;
	const flashFill = blend > 0 ? lerpColor(bodyFill, "#ff5050", blend) : bodyFill;
	const flashStroke = blend > 0 ? lerpColor(bodyStroke, "#7a1a1a", blend) : bodyStroke;
	drawTankShape(ctx, def, tank.gunStates, cx, cy, angle, size * sc, 4 * sc, flashFill, flashStroke);
	if (applyRoomFov && tank.maxHealth != null && !(tank.isDead && tank.isDead())) {
		drawHealthBar(ctx, cx, cy, size * sc, tank.health, tank.maxHealth, game.scale, false, tank.shield ?? 0, tank.maxShield ?? 0);
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

// Tank-mockup cache: each class is rendered once to an offscreen canvas using the
// SAME drawTankShape proportions the in-game tank uses (size = TANK_SIZE, stroke = 4),
// just at a higher reference resolution so it scales cleanly. Previews then blit the
// cached image so the box looks pixel-equivalent to the real thing.
const MOCKUP_REFERENCE_SIZE = 24;        // in-game equivalent: a max-level tank radius.
const MOCKUP_RES_SCALE = 4;              // 4× supersample for crisp scaling in the preview boxes.
const MOCKUP_PADDING = 24;               // room for barrels and stroke overflow.
const tankMockupCache = new Map();

function getTankMockup(defKey) {
	const cached = tankMockupCache.get(defKey);
	if (cached) return cached;
	const def = TANK_DEFS[defKey];
	const renderSize = MOCKUP_REFERENCE_SIZE * MOCKUP_RES_SCALE;
	const padding = MOCKUP_PADDING * MOCKUP_RES_SCALE;
	const dim = renderSize * 2 + padding * 2;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = dim;
	const mctx = canvas.getContext("2d");
	mctx.lineCap = "round";
	mctx.lineJoin = "round";
	// Use the same stroke ratio (4·sc) the live tank uses; sc here is MOCKUP_RES_SCALE.
	drawTankShape(mctx, def, null, dim / 2, dim / 2, -Math.PI / 2, renderSize, 4 * MOCKUP_RES_SCALE);
	const entry = { canvas, halfDim: dim / 2, refSize: renderSize };
	tankMockupCache.set(defKey, entry);
	return entry;
}

export function renderTankPreview(ctx, tank, x, y, size, angleOverride) {
	const angle = angleOverride ?? -Math.PI / 2;
	const m = getTankMockup(tank.defKey);
	// `size` is the desired body radius in display pixels; the mockup's body radius is
	// renderSize, so scale = size / renderSize maps the mockup correctly.
	const drawScale = size / m.refSize;
	const halfDst = m.halfDim * drawScale;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle + Math.PI / 2);   // mockup was rendered facing -y, rotate to override.
	ctx.drawImage(m.canvas, -halfDst, -halfDst, halfDst * 2, halfDst * 2);
	ctx.restore();
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
	// Defensive: a save can have `state.tanks` snapshotted but `state.tankCount` mismatched
	// (older saves, partial writes, etc.). Pull tankCount up to the snapshot's length so
	// the loop below actually rebuilds every saved tank.
	if (Array.isArray(state.tanks) && state.tanks.length > (state.tankCount | 0)) {
		state.tankCount = state.tanks.length;
	}
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
			if (saved.upgrades) t.upgrades = { ...defaultUpgrades(), ...saved.upgrades };
			t.recomputeSize();
			t.maxHealth = tankMaxHealth(t);
			t.health = saved.health != null ? Math.min(saved.health, t.maxHealth) : t.maxHealth;
			t.maxShield = tankMaxShield(t);
			t.shield = saved.shield != null ? Math.min(saved.shield, t.maxShield) : t.maxShield;
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
		upgrades: { ...t.upgrades },
		health: t.health,
		shield: t.shield,
	}));
}
