import { Vec2 } from "./utils.js";
import { game } from "./game.js";
import { Bullet } from "./tank.js";

// Body: 3× a fully-grown level-42 tank.
//   level-42 tank size = TANK_SIZE × (1 + 42/42) = 12 × 2 = 24, so siege body = 72.
const BODY_SIZE = 72;
const MAX_TANK_SIZE = 24;            // Trapper barrels are sized as if mounted on a max-level tank.
const SPIN_RATE = 0.012;
const SHOOT_INTERVAL = 1000;         // 1 second between volleys

// Trapper barrel geometry mirrors the tank Trapper, in tank-radii units:
//   body: x ∈ [0, 1.5], width 0.7
//   nose: x ∈ [1.5, 1.8], base width 0.7, tip width 0.7×1.7 = 1.19
const TRAP_OUTLINE = [
	[0, 0.35],
	[1.5, 0.35],
	[1.8, 0.35 * 1.7],
	[1.8, -0.35 * 1.7],
	[1.5, -0.35],
	[0, -0.35],
];
const TRAP_TIP_OFFSET = 1.8;         // tip distance from barrel mount, in tank-radii units

const SIEGE_TRAP_SHOOT = {
	isTrap: true,
	speed: 2,        // 40% faster traps
	size: 1.7,
	damage: 1,
	health: 1,
	range: 2.5,
};
// Bullet radius = (24 × 0.7 × 1.7) / 2 = 14.28 — same trap a max tank's Trapper would fire.
const SIEGE_TRAP_BULLET_RADIUS = (MAX_TANK_SIZE * 0.7 * SIEGE_TRAP_SHOOT.size) / 2;

const BASE_FILL = "#3f3f3f";
const BODY_FILL = "#58b0d0";
const BODY_STROKE = "#48646e";
const BARREL_FILL = "#b1b3bc";
const BARREL_STROKE = "#646568";

function drawRoundedPolygon(ctx, points, r) {
	const n = points.length;
	ctx.beginPath();
	for (let i = 0; i < n; i++) {
		const [cx, cy] = points[i];
		const [px, py] = points[(i - 1 + n) % n];
		const [nx, ny] = points[(i + 1) % n];
		const v1x = px - cx, v1y = py - cy;
		const v2x = nx - cx, v2y = ny - cy;
		const l1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
		const l2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
		const radius = Math.min(r, l1 / 2, l2 / 2);
		const ax = cx + (v1x / l1) * radius;
		const ay = cy + (v1y / l1) * radius;
		const bx = cx + (v2x / l2) * radius;
		const by = cy + (v2y / l2) * radius;
		if (i === 0) ctx.moveTo(ax, ay);
		else ctx.lineTo(ax, ay);
		ctx.arcTo(cx, cy, bx, by, radius);
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
		for (let i = this.bullets.length - 1; i >= 0; --i) {
			this.bullets[i].update();
			if (this.bullets[i].dead) this.bullets.splice(i, 1);
		}
	}
	shoot() {
		const tipDist = this.size + TRAP_TIP_OFFSET * MAX_TANK_SIZE;
		for (let i = 0; i < 3; i++) {
			const a = this.angle + (i / 3) * Math.PI * 2;
			const tipX = this.pos.x + Math.cos(a) * tipDist;
			const tipY = this.pos.y + Math.sin(a) * tipDist;
			this.bullets.push(new Bullet(new Vec2(tipX, tipY), a, this, SIEGE_TRAP_SHOOT, 0.7, 1, SIEGE_TRAP_BULLET_RADIUS));
		}
	}
	render(ctx) {
		const sc = game.scale * game.room.fov;
		const cx = this.pos.x * sc;
		const cy = this.pos.y * sc;
		const r = this.size * sc;
		const tankR = MAX_TANK_SIZE * sc;
		const lw = 3 * sc;

		// 1. Hexagonal base — does NOT spin; sits below body, no border, dark gray.
		const baseR = r * 1.25;
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

		// 3. Three trapper barrels, sized like a max-tank's Trapper, mounted at the body edge.
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.angle);
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.fillStyle = BARREL_FILL;
		ctx.strokeStyle = BARREL_STROKE;
		ctx.lineWidth = lw;
		const cornerR = 0.35 * tankR * 0.18;
		for (let i = 0; i < 3; i++) {
			ctx.save();
			ctx.rotate((i / 3) * Math.PI * 2);
			ctx.translate(r, 0);
			const pts = TRAP_OUTLINE.map(([px, py]) => [px * tankR, py * tankR]);
			drawRoundedPolygon(ctx, pts, cornerR);
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
	}
}
