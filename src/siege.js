import { Vec2 } from "./utils.js";
import { game } from "./game.js";
import { Bullet } from "./tank.js";

// Body: 3× a fully-grown level-42 tank.
//   level-42 tank size = TANK_SIZE × (1 + 42/42) = 12 × 2 = 24, so siege body = 72.
const BODY_SIZE = 72;
const MAX_TANK_SIZE = 24;            // Trapper barrels are sized as if mounted on a max-level tank.
const BARREL_TANK_SIZE = MAX_TANK_SIZE * 1.5;  // Sanctuary trap launchers render 1.5× a max tank's.
const BARREL_COUNT = 3;
const SPIN_RATE = 0.012;
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

// Matches the tank Trapper's shoot config exactly.
const SIEGE_TRAP_SHOOT = {
	isTrap: true,
	damage: 1.5,
	speed: 1.5,
	size: 1.7,
	range: 2.5,
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

// Tri auto turret: huge non-targeting turret with three trap-style barrels at 120° apart.
// Body section width matches the trapezoid's wider (tip) end.
const TRI_SIZE = MAX_TANK_SIZE * 1.4;        // 40% bigger than a fully-grown tank.
const TRI_TRAP_BODY_LEN = 1.5;
const TRI_TRAP_NOSE_LEN = 0.3;
const TRI_TRAP_NOSE_ASPECT = TRAP_NOSE_ASPECT;
const TRI_TRAP_BODY_W = 0.8;                 // matches a Basic barrel's width.
const TRI_TRAP_NOSE_W = TRI_TRAP_BODY_W / TRI_TRAP_NOSE_ASPECT;  // base narrows so tip matches body.
const TRI_TRAP_TOTAL_LEN = TRI_TRAP_BODY_LEN + TRI_TRAP_NOSE_LEN;
const TRI_SPIN_RATE = 0.005;                 // slow spin.
const TRI_SHOOT_INTERVAL = 1000;             // ms; all three barrels fire together.
const TRI_BULLET_RADIUS = (TRI_SIZE * TRI_TRAP_NOSE_W * TRI_TRAP_NOSE_ASPECT) / 2;
const TRI_TRAP_SHOOT_CFG = {
	...TURRET_SHOOT_CFG,
	isTrap: true,
	size: 1.7,
	range: 2.5,
};

const BASE_FILL = "#3f3f3f";
const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
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
	constructor() {
		this.pos = new Vec2();
		this.angle = 0;
		this.size = BODY_SIZE;
		this.bullets = [];
		this.shootTime = 0;
		this.gunStates = Array.from({ length: BARREL_COUNT }, () => ({ position: 0, motion: 0 }));
		this.triTurret = {
			angle: 0,
			shootTime: 0,
			gunStates: Array.from({ length: 3 }, () => ({ position: 0, motion: 0 })),
		};
	}
	updateTriTurret(now) {
		this.triTurret.angle += TRI_SPIN_RATE;
		if (now > this.triTurret.shootTime) {
			for (let i = 0; i < 3; i++) {
				const a = this.triTurret.angle + (i / 3) * Math.PI * 2;
				const tipX = this.pos.x + Math.cos(a) * TRI_TRAP_TOTAL_LEN * TRI_SIZE;
				const tipY = this.pos.y + Math.sin(a) * TRI_TRAP_TOTAL_LEN * TRI_SIZE;
				this.bullets.push(new Bullet(new Vec2(tipX, tipY), a, this, TRI_TRAP_SHOOT_CFG, TRI_TRAP_NOSE_W, 1, TRI_BULLET_RADIUS));
				this.triTurret.gunStates[i].motion += RECOIL_IMPULSE;
			}
			this.triTurret.shootTime = now + TRI_SHOOT_INTERVAL;
		}
		for (const gs of this.triTurret.gunStates) {
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
		if (now > this.shootTime) {
			this.shoot();
			this.shootTime = now + SHOOT_INTERVAL;
		}
		this.updateTriTurret(now);
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
		for (let i = 0; i < BARREL_COUNT; i++) {
			const a = this.angle + (i / BARREL_COUNT) * Math.PI * 2;
			const tipX = this.pos.x + Math.cos(a) * tipDist;
			const tipY = this.pos.y + Math.sin(a) * tipDist;
			this.bullets.push(new Bullet(new Vec2(tipX, tipY), a, this, SIEGE_TRAP_SHOOT, 0.7, 1, SIEGE_TRAP_BULLET_RADIUS));
			this.gunStates[i].motion += RECOIL_IMPULSE;
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
		for (let i = 0; i < BARREL_COUNT; i++) {
			ctx.save();
			ctx.rotate((i / BARREL_COUNT) * Math.PI * 2);
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

		// 4. Main circular body on top of barrel mounts.
		ctx.fillStyle = BODY_FILL;
		ctx.strokeStyle = BODY_STROKE;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		// 4.5. Tri auto turret — huge barrel-colored body with three trap-style barrels.
		const triR = TRI_SIZE * sc;
		const triUnit = TRI_SIZE * sc;
		const triBodyLen = TRI_TRAP_BODY_LEN * triUnit;
		const triBodyHalfW = (TRI_TRAP_BODY_W / 2) * triUnit;
		const triNoseStart = triBodyLen;
		const triNoseEnd = triNoseStart + TRI_TRAP_NOSE_LEN * triUnit;
		const triNoseBaseHalfW = (TRI_TRAP_NOSE_W / 2) * triUnit;
		const triNoseTipHalfW = triNoseBaseHalfW * TRI_TRAP_NOSE_ASPECT;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.triTurret.angle);
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		for (let i = 0; i < 3; i++) {
			ctx.save();
			ctx.rotate((i / 3) * Math.PI * 2);
			const recoil = this.triTurret.gunStates[i].position * triUnit;
			ctx.translate(-recoil, 0);
			// Body section (width matches the trapezoid's wider end).
			drawSharpPolygon(ctx, [
				[0, triBodyHalfW],
				[triBodyLen, triBodyHalfW],
				[triBodyLen, -triBodyHalfW],
				[0, -triBodyHalfW],
			]);
			ctx.fill();
			ctx.stroke();
			// Flared trap nose.
			drawSharpPolygon(ctx, [
				[triNoseStart, triNoseBaseHalfW],
				[triNoseEnd, triNoseTipHalfW],
				[triNoseEnd, -triNoseTipHalfW],
				[triNoseStart, -triNoseBaseHalfW],
			]);
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
		ctx.beginPath();
		ctx.arc(0, 0, triR, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.restore();

		// 4.6. Healer icon — OSA-style red plus mounted on the Tri turret, sized to fit.
		const healerR = triR * 0.7;
		ctx.fillStyle = HEALER_FILL;
		ctx.strokeStyle = HEALER_STROKE;
		ctx.lineWidth = lw;
		ctx.lineJoin = "round";
		ctx.beginPath();
		for (let i = 0; i < HEALER_SHAPE.length; i++) {
			const px = cx + HEALER_SHAPE[i][0] * healerR;
			const py = cy + HEALER_SHAPE[i][1] * healerR;
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

	}
}
