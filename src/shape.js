import { state } from "./state.js";
import { Vec2, darken, colors, formatNumber } from "./utils.js";
import { mouse } from "./input.js";
import { drawPolygon } from "./render.js";
import { game } from "./game.js";

const LOG5 = Math.log(5);

export function shapeTypeFromBuff(buff) {
	return Math.log(5 + buff) / LOG5;
}
export function shapeRarityFromBuff(buff) {
	return 1 + buff;
}

export const TYPE_NAMES = ["Egg", "Square", "Triangle", "Pentagon", "Hexagon", "Heptagon", "Octagon", "Nonagon"];
const TYPE_COLORS = [colors.egg, colors.square, colors.triangle, colors.pentagon, colors.hexagon, colors.heptagon, colors.octagon, colors.nonagon];
const RARITY_COLORS = [colors.shiny, colors.legendary, colors.shadow, colors.ultra];
const TYPE_SIZES = [5, 20, 20, 26, 28, 56, 112, 224];
const TYPE_SIDES = [0, 4, 3, 5, 6, 7, 8, 9];
const TYPE_BASE_SCORES = [1, 200, 40000, 8e6, 16e8, 32e10, 64e12, 128e14];

export function makeShapeData(type, rarity, layers) {
	const color = rarity >= 0 ? RARITY_COLORS[rarity] : TYPE_COLORS[type];
	return {
		type,
		rarity,
		size: TYPE_SIZES[type],
		sides: TYPE_SIDES[type],
		color,
		score: TYPE_BASE_SCORES[type] * Math.pow(5, layers) * Math.pow(10, Math.max(0, rarity + 1)),
	};
}

export function randomShapeType(typeRoll, rarityRoll, layers) {
	let type = Math.min(4, shapeTypeFromBuff(typeRoll) | 0) - 1;
	if (type === 3 && state.pentagonsUnlocked && Math.random() < 1 / 6) type = 4;
	const rarity = Math.min(state.rarityCap, Math.floor(shapeRarityFromBuff(rarityRoll)) - 2);
	return makeShapeData(type, rarity, layers);
}

export class Shape {
	constructor(pos) {
		this.pos = pos;
		this.angle = Math.random() * Math.PI * 2;
		this.velocity = new Vec2();
		this.fillStyle = "#000";
		this.strokeStyle = "#000";
		this.sides = 0;
		this.size = 10;
		this.drawSize = 1;
		this.layers = 1;
		this.score = 0;
		this.evoTime = 0;
		this.type = 0;
		this.rarity = -1;
		this.health = 1;
	}
	static random() {
		const shape = new Shape(
			new Vec2(
				game.room.minX + Math.random() * game.room.maxX,
				game.room.minY + Math.random() * game.room.maxY,
			),
		);
		shape.layers = 1;
		shape.setType(
			randomShapeType(
				Math.pow(Math.random(), 2) * state.shapeTypeBuff,
				Math.pow(Math.random(), 5) * state.shapeRarityBuff,
				shape.layers,
			),
		);
		shape.setEvoTime();
		return shape;
	}
	setType(data) {
		this.fillStyle = data.color;
		this.strokeStyle = darken(data.color);
		this.sides = data.sides;
		this.size = data.size;
		this.score = data.score;
		this.type = data.type;
		this.rarity = data.rarity ?? -1;
		this.health = data.type + 1;
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		const triangleAdjust = this.sides === 3 && this.layers > 1 ? 2 / (2 + (this.layers - 1)) : 1;
		this.size /= Math.pow(cosFactor, this.layers - 1);
		this.size *= triangleAdjust;
	}
	evolve() {
		this.layers += 1;
		this.score *= 5;
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		this.size = TYPE_SIZES[this.type];
		const triangleAdjust = this.sides === 3 && this.layers > 1 ? 2 / (2 + (this.layers - 1)) : 1;
		this.size /= Math.pow(cosFactor, this.layers - 1);
		this.size *= triangleAdjust;
		this.setEvoTime();
	}
	setEvoTime() {
		this.evoTime =
			performance.now() +
			(this.layers * (1 + this.type) * 1e4 * (0.5 + Math.random())) / state.shapeEvoNerf[this.type];
	}
	update() {
		if (this.layers < state.layersCaps[this.type] && performance.now() > this.evoTime) this.evolve();
		this.drawSize = this.drawSize * 0.95 + this.size * 0.05;
		if ((mouse.leftClick || mouse.right) && !game.debugMode && !game.controlledTank) {
			const screenScale = game.scale * game.room.fov;
			const dx = mouse.x - this.pos.x * screenScale;
			const dy = mouse.y - this.pos.y * screenScale;
			const overlap = (mouse.leftClick ? 10 : 100) + this.size * screenScale - Math.sqrt(dx * dx + dy * dy);
			if (overlap > 0) {
				if (mouse.leftClick) {
					this.health -= 1;
					if (this.isDead()) {
						state.score += this.score;
						game.flyingText.push({
							x: this.pos.x * screenScale,
							y: this.pos.y * screenScale,
							alpha: 1,
							text: "+" + formatNumber(this.score),
						});
					}
				} else {
					const angle = Math.atan2(dy, dx);
					const push = Vec2.circle(angle, overlap / 100);
					this.velocity.sub(push);
				}
			}
		}
		const edgeForce = game.room.applyForce(this.pos, this.size, 0.001);
		this.velocity.add(edgeForce);
		this.velocity.add(Vec2.circle(this.angle + 1, 1 / 30 / Math.sqrt(this.size)));
		this.evoTime -= this.velocity.length() * 10;
		this.angle += (0.1 + this.velocity.length()) / 150;
		this.pos.add(this.velocity);
		this.velocity.mulVal(0.98);
	}
	render(ctx) {
		const sides = Math.max(3, this.sides);
		const cosFactor = Math.cos(Math.PI / sides);
		ctx.fillStyle = darken(this.fillStyle, (this.health + 1) / (this.type + 2));
		ctx.strokeStyle = darken(this.strokeStyle, (this.health + 1) / (this.type + 2));
		ctx.lineWidth = 3 * game.scale * game.room.fov;
		for (let i = 0; i < this.layers; ++i) {
			drawPolygon(
				ctx,
				this.pos.x,
				this.pos.y,
				this.drawSize * Math.pow(cosFactor, i),
				this.angle + (i & 1 ? 0 : Math.PI / sides),
				this.sides,
			);
			ctx.fill();
			ctx.stroke();
		}
	}
	collide(other) {
		const dx = other.pos.x - this.pos.x;
		const dy = other.pos.y - this.pos.y;
		const overlap = this.size + other.size - Math.sqrt(dx * dx + dy * dy);
		if (overlap < 0) return;
		const angle = Math.atan2(dy, dx);
		this.pos.sub(Vec2.circle(angle, overlap).divideVal(this.size));
		other.pos.add(Vec2.circle(angle, overlap).divideVal(other.size));
	}
	isDead() {
		return this.health <= 0;
	}
}
