import { Vec2, REGEN_PER_FRAME, lerpColor, darken } from "./utils.js";
import { state } from "./state.js";
import { game } from "./game.js";
import { Bullet } from "./tank.js";
import { drawHealthBar } from "./render.js";

// Body: 3× a fully-grown level-42 tank.
//   level-42 tank size = TANK_SIZE × (1 + 42/42) = 12 × 2 = 24, so siege body = 72.
const BODY_SIZE = 72;
const MAX_TANK_SIZE = 24;            // Trapper barrels are sized as if mounted on a max-level tank.
const BARREL_TANK_SIZE = MAX_TANK_SIZE * 1.5;  // Sanctuary trap launchers render 1.5× a max tank's.
// Sanctuary tiers. Tier 2 doubles barrel counts and halves shoot intervals across the board.
const SANCTUARY_TIERS = {
	1: { trapCount: 3, healerCount: 3, reloadMul: 1 },
	2: { trapCount: 6, healerCount: 6, reloadMul: 0.5 },
};
// OSA Class.sanctuary FACING_TYPE: ["spin", { speed: 0.025 }]. Doubled from our previous 0.012.
const SPIN_RATE = 0.024;
const SHOOT_INTERVAL = 1000;         // 1 second between volleys
const RECOIL_IMPULSE = 0.3;
const RECOIL_SPRING = 0.2;
const RECOIL_DAMP = 0.5;

// Trapper barrel geometry, in tank-radii units. Matches the tank Trapper exactly:
// 1.5 body + 0.3 nose, width 0.7, aspect 1.7.
const TRAP_BODY_LEN = 1.5;
const TRAP_BODY_W = 0.84;            // tank Trapper width 0.7 × 1.2 (20% wider).
const TRAP_NOSE_LEN = 0.3;
const TRAP_NOSE_W = 0.84;
const TRAP_NOSE_ASPECT = 1.7;
const TRAP_TIP_OFFSET = TRAP_BODY_LEN + TRAP_NOSE_LEN;
// Mount inset (in BARREL_TANK_SIZE units): how deep the barrel root sits inside the body.
// Higher = barrel pulled closer to the Sanctuary; tip protrusion = barrel_length − inset.
const MOUNT_INSET_FACTOR = 1.24;

// OSA Class.sanctuaryTier* trap gun PROPERTIES.SHOOT_SETTINGS:
//   combineStats([g.trap, { shudder: 0.15, health: 7, reload: 1.5, speed: 1 }])
//   g.trap: { reload: 23, shudder: 0.25, size: 0.7, damage: 0.75, speed: 3.25, resist: 3, spray: 0 }
// Net trap-bullet multipliers used here:
//   speed = 3.25 × 1 ≈ 3.25 (we keep 1.5 since our isTrap path halves speed gain anyway)
//   damage = 0.75 (vs base) — softer per-hit
//   size = 1.7 (matching tank Trapper visual)
//   range = 2.5
//   health = 7 — was missing; this is what kept sanctuary traps too fragile.
const SIEGE_TRAP_SHOOT = {
	isTrap: true,
	damage: 1.5,                                 // 2× OSA's 0.75.
	speed: 1.5,
	size: 1.7,
	range: 2.5,
	health: 14,                                  // 2× OSA's 7.
	// OSA gunvals.trap has resist: 3 (multiplier) and ~3× pen via STAT_CALCULATOR("trap").
	// Without this override the trap inherits pen=1 → ratio damage tails off fast as it
	// chips, and resistDiff with a 0.88-resist Sentry destroys it. Setting penetration: 3
	// keeps trap damage flat through its lifespan; resist is now inherited from the
	// sanctuary's own 0.879 so trades against Sentries are roughly even.
	penetration: 4.5,            // +50% over the prior 3.0 — chips through Sentry/SS resist faster.
	// Sanctuary traps are a defensive shell — they shouldn't touch polygons.
	ignoreFood: true,
};
// Bullet radius matches the launcher's nose-tip width.
const SIEGE_TRAP_BULLET_RADIUS = (BARREL_TANK_SIZE * TRAP_NOSE_W * TRAP_NOSE_ASPECT) / 2;

// Sanctuary's fixed bullet config — used by every Sanctuary-mounted turret.
const TURRET_SHOOT_CFG = {
	speed: 1,
	health: 2,                               // +100% health (sanctuary boost).
	ignoreUpgradeSpeed: true,
	ignoreUpgradeDamage: true,
	ignoreUpgradeHealth: true,
};

// Auto Healer Turret: huge non-targeting turret with three trap-style barrels at 120° apart.
// Carries the healer hat at its center and shoots green heal-traps that restore HP to injured
// tanks on contact. Body section width matches the trapezoid's wider (tip) end.
const HEALER_SIZE = MAX_TANK_SIZE * 1.4;     // 40% bigger than a fully-grown tank.
const HEALER_BODY_LEN = 1.5;
const HEALER_NOSE_LEN = 0.3;
const HEALER_NOSE_ASPECT = TRAP_NOSE_ASPECT;
const HEALER_BODY_W = 0.8;                   // matches a Basic barrel's width.
const HEALER_NOSE_W = HEALER_BODY_W / HEALER_NOSE_ASPECT;
const HEALER_TOTAL_LEN = HEALER_BODY_LEN + HEALER_NOSE_LEN;
const HEALER_SPIN_RATE = 0.005;
const HEALER_SHOOT_INTERVAL = 333;            // ms; 3× the prior fire rate (was 1000).
const HEALER_BULLET_RADIUS = (HEALER_SIZE * HEALER_NOSE_W * HEALER_NOSE_ASPECT) / 2;
const HEALER_BULLET_CFG = {
	...TURRET_SHOOT_CFG,
	isHeal: true,
	healAmount: 2,            // HP restored per impact (halved from prior 4 to balance triple fire rate).
	damage: 0,                // no damage to anything.
	size: 1.7,
	// Traps quickly slow to a near-stop and only reach ~130 world units total. A non-trap
	// bullet at constant speed needs a much shorter life to cover roughly the same distance.
	range: 0.4,
};

const BASE_FILL = "#3f3f3f";
const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
// Neutral sanctuary uses OSA yellow (#feca3f) — same as the arena-closer zone tile.
const NEUTRAL_BODY_FILL = "#feca3f";
const NEUTRAL_BODY_STROKE = darken(NEUTRAL_BODY_FILL);
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";
const HEALER_FILL = "#e4363b";
const HEALER_STROKE = "#7e3b3d";

// OSA healerHat polygon, normalized to ±1 extents (12-vertex plus/cross).
const HEALER_SHAPE = [
	[0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3],
	[0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3],
	[-1, -0.3], [-0.3, -0.3], [-0.3, -1], [0.3, -1],
];

// OSA-style sharp polygon path. lineJoin="round" softens corners during stroke.
function drawSharpPolygon(ctx, points) {
	ctx.beginPath();
	for (let i = 0; i < points.length; i++) {
		const [x, y] = points[i];
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

export class Siege {
	constructor(tier = 1, opts = {}) {
		const cfg = SANCTUARY_TIERS[tier] ?? SANCTUARY_TIERS[1];
		this.tier = tier;
		// Neutral sanctuary: no trap launchers, no healer turret, yellow body, untargetable
		// by enemies (sentries filter it out). Acts as a passive landmark inside the
		// dominator / arena-closer zone.
		this.neutral = !!opts.neutral;
		this.trapCount = this.neutral ? 0 : cfg.trapCount;
		this.healerCount = this.neutral ? 0 : cfg.healerCount;
		this.reloadMul = cfg.reloadMul;
		this.pos = new Vec2();
		this.angle = 0;
		this.size = BODY_SIZE;
		this.maxHealth = 300;
		this.health = 300;
		this.damageBlend = 0;        // OSA-style red hit-flash; gated by state.damageBlendEnabled.
		// OSA collision fields. Class.sanctuary BODY: { HEALTH: 1280, DAMAGE: 5.5, SHIELD: ... },
		// LEVEL 45 with full skills → brst ≈ 8.25 → resist = 1 - 1/8.25 ≈ 0.879. Same scale as Sentry.
		this.penetration = 3;
		this.resist = 1 - 1 / 8.25;
		this.damage = 5.5;           // chips bullets that ram into the sanctuary.
		this.damageType = 0;         // not food.
		this.bullets = [];
		this.shootTime = 0;
		this.gunStates = Array.from({ length: this.trapCount }, () => ({ position: 0, motion: 0 }));
		this.healerTurret = {
			angle: 0,
			shootTime: 0,
			gunStates: Array.from({ length: this.healerCount }, () => ({ position: 0, motion: 0 })),
		};
	}
	updateHealerTurret(now) {
		this.healerTurret.angle += HEALER_SPIN_RATE;
		if (now > this.healerTurret.shootTime) {
			for (let i = 0; i < this.healerCount; i++) {
				const a = this.healerTurret.angle + (i / this.healerCount) * Math.PI * 2;
				const tipX = this.pos.x + Math.cos(a) * HEALER_TOTAL_LEN * HEALER_SIZE;
				const tipY = this.pos.y + Math.sin(a) * HEALER_TOTAL_LEN * HEALER_SIZE;
				this.bullets.push(new Bullet(new Vec2(tipX, tipY), a, this, HEALER_BULLET_CFG, HEALER_NOSE_W, 1, HEALER_BULLET_RADIUS));
				this.healerTurret.gunStates[i].motion += RECOIL_IMPULSE;
			}
			this.healerTurret.shootTime = now + HEALER_SHOOT_INTERVAL * this.reloadMul;
		}
		for (const gs of this.healerTurret.gunStates) {
			gs.motion -= RECOIL_SPRING * gs.position;
			gs.position += gs.motion;
			if (gs.position < 0) { gs.position = 0; gs.motion = -gs.motion; }
			if (gs.motion > 0) gs.motion *= RECOIL_DAMP;
		}
	}
	update() {
		this.pos.x = game.room.minX + game.room.maxX / 2;
		this.pos.y = game.room.minY + game.room.maxY / 2;
		this.angle += SPIN_RATE;
		const now = performance.now();
		if (!this.neutral && now > this.shootTime) {
			this.shoot();
			this.shootTime = now + SHOOT_INTERVAL * this.reloadMul;
		}
		if (!this.neutral) this.updateHealerTurret(now);
		if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + REGEN_PER_FRAME);
		this.damageBlend *= 0.85;
		if (this.damageBlend < 0.01) this.damageBlend = 0;
		// Per-barrel recoil spring
		for (const gs of this.gunStates) {
			gs.motion -= RECOIL_SPRING * gs.position;
			gs.position += gs.motion;
			if (gs.position < 0) { gs.position = 0; gs.motion = -gs.motion; }
			if (gs.motion > 0) gs.motion *= RECOIL_DAMP;
		}
		for (let i = this.bullets.length - 1; i >= 0; --i) {
			this.bullets[i].update();
			if (this.bullets[i].dead) this.bullets.splice(i, 1);
		}
	}
	shoot() {
		// Mount is inset by 0.78 tank-radius inside the body, then barrel extends outward.
		const tipDist = (this.size - BARREL_TANK_SIZE * MOUNT_INSET_FACTOR) + TRAP_TIP_OFFSET * BARREL_TANK_SIZE;
		for (let i = 0; i < this.trapCount; i++) {
			const a = this.angle + (i / this.trapCount) * Math.PI * 2;
			const tipX = this.pos.x + Math.cos(a) * tipDist;
			const tipY = this.pos.y + Math.sin(a) * tipDist;
			this.bullets.push(new Bullet(new Vec2(tipX, tipY), a, this, SIEGE_TRAP_SHOOT, 0.7, 1, SIEGE_TRAP_BULLET_RADIUS));
			this.gunStates[i].motion += RECOIL_IMPULSE;
		}
	}
	takeDamage(n) {
		if (this.neutral) return;   // neutral sanctuary is invulnerable.
		this.health = Math.max(0, this.health - n);
		this.damageBlend = 1;
		// Fallen sanctuaries don't despawn — they collapse into a neutral husk
		// that the player can find on the map and pay to repair.
		if (this.health <= 0) {
			this.neutral = true;
			this.trapCount = 0;
			this.healerCount = 0;
			this.health = this.maxHealth;
			this.bullets.length = 0;
			this.damageBlend = 0;
			// Track death count for the per-map repair-cost ramp.
			state.sanctuaryDeaths = (state.sanctuaryDeaths || 0) + 1;
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const r = this.size * sc;
		const tankR = BARREL_TANK_SIZE * sc;
		const lw = 4 * sc;

		// 1. Hexagonal base — does NOT spin; sits below body, no border, dark gray.
		const baseR = r * 1.3;
		ctx.fillStyle = BASE_FILL;
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2; // fixed orientation
			const x = cx + Math.cos(a) * baseR;
			const y = cy + Math.sin(a) * baseR;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.fill();

		// 2. Bullets — drawn under barrels, over base.
		for (const b of this.bullets) b.render(ctx);

		if (this.neutral) {
			// Neutral sanctuary: yellow body only (no barrels, no healer turret).
			const blendN = state.damageBlendEnabled ? this.damageBlend * 0.5 : 0;
			ctx.fillStyle = blendN > 0 ? lerpColor(NEUTRAL_BODY_FILL, "#ff5050", blendN) : NEUTRAL_BODY_FILL;
			ctx.strokeStyle = blendN > 0 ? lerpColor(NEUTRAL_BODY_STROKE, "#7a1a1a", blendN) : NEUTRAL_BODY_STROKE;
			ctx.lineWidth = lw;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			return;
		}

		// 3. Three trapper barrels: render body section + flared nose as TWO separate
		// sharp polygons each. Strokes overlap at the seam, producing the bisecting
		// line OSA shows. Stroke first, then fill (OSA order) so only the outer half
		// of each stroke remains visible — the seam is exactly one stroke-width wide.
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.angle);
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = lw;
		const bodyLen = TRAP_BODY_LEN * tankR;
		const bodyHalfW = (TRAP_BODY_W / 2) * tankR;
		const noseStart = bodyLen;
		const noseEnd = noseStart + TRAP_NOSE_LEN * tankR;
		const noseBaseHalfW = (TRAP_NOSE_W / 2) * tankR;
		const noseTipHalfW = noseBaseHalfW * TRAP_NOSE_ASPECT;
		// Mount inset so the barrel sticks out only ~half its previous protrusion.
		const mountInset = (this.size - BARREL_TANK_SIZE * MOUNT_INSET_FACTOR) * sc;
		for (let i = 0; i < this.trapCount; i++) {
			ctx.save();
			ctx.rotate((i / this.trapCount) * Math.PI * 2);
			const recoilOffset = this.gunStates[i].position * BARREL_TANK_SIZE * sc;
			ctx.translate(mountInset - recoilOffset, 0);
			// Body section
			drawSharpPolygon(ctx, [
				[0, bodyHalfW],
				[bodyLen, bodyHalfW],
				[bodyLen, -bodyHalfW],
				[0, -bodyHalfW],
			]);
			ctx.fill();
			ctx.stroke();
			// Flared nose
			drawSharpPolygon(ctx, [
				[noseStart, noseBaseHalfW],
				[noseEnd, noseTipHalfW],
				[noseEnd, -noseTipHalfW],
				[noseStart, -noseBaseHalfW],
			]);
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
		ctx.restore();

		// 4. Main circular body on top of barrel mounts. Includes the OSA red hit-flash
		// when state.damageBlendEnabled is on and damageBlend > 0.
		const blend = state.damageBlendEnabled ? this.damageBlend * 0.5 : 0;
		ctx.fillStyle = blend > 0 ? lerpColor(BODY_FILL, "#ff5050", blend) : BODY_FILL;
		ctx.strokeStyle = blend > 0 ? lerpColor(BODY_STROKE, "#7a1a1a", blend) : BODY_STROKE;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		// 4.5. Auto Healer Turret — huge barrel-colored body with three trap-style barrels
		// and the healer hat mounted on top. The hat is rendered without spinning so the
		// red plus stays upright while the barrels rotate beneath it.
		const healerTurretR = HEALER_SIZE * sc;
		const healerUnit = HEALER_SIZE * sc;
		const healerBodyLen = HEALER_BODY_LEN * healerUnit;
		const healerBodyHalfW = (HEALER_BODY_W / 2) * healerUnit;
		const healerNoseStart = healerBodyLen;
		const healerNoseEnd = healerNoseStart + HEALER_NOSE_LEN * healerUnit;
		const healerNoseBaseHalfW = (HEALER_NOSE_W / 2) * healerUnit;
		const healerNoseTipHalfW = healerNoseBaseHalfW * HEALER_NOSE_ASPECT;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.save();
		ctx.rotate(this.healerTurret.angle);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		for (let i = 0; i < this.healerCount; i++) {
			ctx.save();
			ctx.rotate((i / this.healerCount) * Math.PI * 2);
			const recoil = this.healerTurret.gunStates[i].position * healerUnit;
			ctx.translate(-recoil, 0);
			drawSharpPolygon(ctx, [
				[0, healerBodyHalfW],
				[healerBodyLen, healerBodyHalfW],
				[healerBodyLen, -healerBodyHalfW],
				[0, -healerBodyHalfW],
			]);
			ctx.fill();
			ctx.stroke();
			drawSharpPolygon(ctx, [
				[healerNoseStart, healerNoseBaseHalfW],
				[healerNoseEnd, healerNoseTipHalfW],
				[healerNoseEnd, -healerNoseTipHalfW],
				[healerNoseStart, -healerNoseBaseHalfW],
			]);
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
		ctx.beginPath();
		ctx.arc(0, 0, healerTurretR, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
		// Healer hat mounted on top, sized to fit the turret.
		const healerHatR = healerTurretR * 0.7;
		ctx.fillStyle = HEALER_FILL;
		ctx.strokeStyle = HEALER_STROKE;
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (let i = 0; i < HEALER_SHAPE.length; i++) {
			const px = HEALER_SHAPE[i][0] * healerHatR;
			const py = HEALER_SHAPE[i][1] * healerHatR;
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();

		// 6. Health bar — wide bar below the hexagonal base.
		drawHealthBar(ctx, cx, cy + r * 0.3, r * 1.1, this.health, this.maxHealth, game.scale);
	}
}
