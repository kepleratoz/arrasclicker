import { state } from "./state.js";
import { Vec2 } from "./utils.js";
import { game } from "./game.js";

export class Room {
	minX = 120;
	minY = 120;
	maxX = 840;
	maxY = 840;
	fov = 2;
	update() {
		// Map 1 base size (no arena upgrades): maxX = 1080/2 - 240 = 300.
		// Map 2 is exactly 5x5 walls wide (5 × 280 = 1400), ignoring arena upgrades.
		if (state.currentMap === 1) {
			const targetSize = 5 * 280;   // 5 walls × MAP_FULL.
			this.fov = 1080 / (targetSize + 240);
		} else {
			this.fov = 2 / Math.pow(2, state.arenaFovUpgrades);
		}
		this.minX = 120;
		this.minY = 120;
		this.maxX = 1080 / this.fov - 240;
		this.maxY = 1080 / this.fov - 240;
	}
	render(ctx) {
		ctx.fillStyle = "#d0d0d0";
		ctx.fillRect(0, 0, game.width, game.height);
		ctx.fillStyle = "#dbdbdb";
		ctx.fillRect(
			this.minX * game.scale * this.fov,
			this.minY * game.scale * this.fov,
			this.maxX * game.scale * this.fov,
			this.maxY * game.scale * this.fov,
		);
		if (state.arenaFovUpgrades >= 1) {
			const sc = game.scale * this.fov;
			// Map 2: zone is exactly 2x2 walls (2 × 280 = 560). Map 1: keep maxX/3 (matches
			// the upgraded map 1's 1x1 wall = 280).
			const nestWorld = state.currentMap === 1 ? 2 * 280 : this.maxX / 3;
			const nestW = nestWorld * sc;
			const nestH = nestWorld * sc;
			const nestX = (this.minX + this.maxX / 2) * sc - nestW / 2;
			const nestY = (this.minY + this.maxY / 2) * sc - nestH / 2;
			// Map 2 uses the OSA dominator/arena-closer yellow (#feca3f); Map 1 keeps
			// its original purple nest tint so the neutral color is reserved for Map 2.
			ctx.fillStyle = state.currentMap === 1
				? "rgba(254,202,63,0.32)"
				: "rgba(181,142,253,0.32)";
			ctx.fillRect(nestX, nestY, nestW, nestH);
		}
		ctx.beginPath();
		const gridSize = 30 * game.scale * this.fov;
		// Anchor the grid so a vertical and horizontal line pass through the exact
		// center of the playable map (not the canvas center) — keeps the grid aligned
		// with the map regardless of arena fov / map index.
		const sc = game.scale * this.fov;
		const mapCx = (this.minX + this.maxX / 2) * sc;
		const mapCy = (this.minY + this.maxY / 2) * sc;
		const startX = ((mapCx % gridSize) + gridSize) % gridSize;
		const startY = ((mapCy % gridSize) + gridSize) % gridSize;
		for (let x = startX; x < game.width; x += gridSize) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, game.height);
		}
		for (let y = startY; y < game.height; y += gridSize) {
			ctx.moveTo(0, y);
			ctx.lineTo(game.width, y);
		}
		ctx.lineWidth = (game.scale / 2) * this.fov;
		ctx.strokeStyle = "rgba(0,0,0,0.1)";
		ctx.stroke();
	}
	applyForce(pos, radius, strength) {
		const force = new Vec2();
		force.x -= Math.min(0, pos.x - radius - this.minX) * strength;
		force.y -= Math.min(0, pos.y - radius - this.minY) * strength;
		force.x -= Math.max(0, pos.x + radius - this.minX - this.maxX) * strength;
		force.y -= Math.max(0, pos.y + radius - this.minY - this.maxY) * strength;
		return force;
	}
}
