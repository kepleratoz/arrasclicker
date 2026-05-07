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
		this.minX = 120;
		this.minY = 120;
		this.maxX = 1080 / this.fov - 240;
		this.maxY = 1080 / this.fov - 240;
		this.fov = 2 / Math.pow(2, state.arenaFovUpgrades);
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
		ctx.beginPath();
		const gridSize = 30 * game.scale * this.fov;
		for (let x = (game.width / 2) % gridSize; x < game.width; x += gridSize) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, game.height);
		}
		for (let y = (game.height / 2) % gridSize; y < game.height; y += gridSize) {
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
