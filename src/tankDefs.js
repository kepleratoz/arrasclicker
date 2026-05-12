// All ratios pre-divided by 10 (matching OSA's mockupEntity.js where this.length = LENGTH/10).
// `shoot` is omitted for purely cosmetic guns (e.g. Trapper's body section).
// Stat multipliers (reload/damage/speed/size/range) are relative to Basic.
export const TANK_DEFS = {
	basic: {
		label: "Basic",
		guns: [{ length: 1.8, width: 0.8, x: 0, y: 0, angle: 0, shoot: {} }],
		upgrades: ["twin", "sniper", "machineGun", "flankGuard", "pounder", "trapper", "director"],
	},
	// OSA bullet-speed multipliers (gunvals.js → speed / maxSpeed):
	//   basic = 1, twin uses basic, sniper = 1.5, machineGun maxSpeed = 0.8,
	//   flankGuard maxSpeed = 0.85, pounder = 0.85.
	twin: {
		label: "Twin",
		guns: [
			{ length: 2.0, width: 0.8, x: 0, y: 0.55, angle: 0, shoot: { damage: 0.7, delay: 0 } },
			{ length: 2.0, width: 0.8, x: 0, y: -0.55, angle: 0, shoot: { damage: 0.7, delay: 0.5 } },
		],
	},
	sniper: {
		label: "Sniper",
		guns: [{ length: 2.4, width: 0.8, x: 0, y: 0, angle: 0, shoot: { reload: 1.35, damage: 0.8, speed: 1.5, range: 1.5 } }],
	},
	machineGun: {
		label: "Machine Gun",
		guns: [{ length: 1.2, width: 1.0, aspect: 1.4, x: 0.8, y: 0, angle: 0, shoot: { reload: 0.5, damage: 0.7, speed: 0.8, size: 0.92, health: 0.7, spray: 2.5, shudder: 1.7 } }],
	},
	flankGuard: {
		label: "Flank Guard",
		guns: [
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: 0, shoot: { speed: 0.85 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (2 * Math.PI) / 3, shoot: { speed: 0.85, delay: 0.33 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (4 * Math.PI) / 3, shoot: { speed: 0.85, delay: 0.67 } },
		],
	},
	pounder: {
		label: "Pounder",
		guns: [{ length: 2.05, width: 1.2, x: 0, y: 0, angle: 0, shoot: { reload: 2, damage: 2, speed: 0.85, size: 1.2, health: 4 } }],
	},
	trapper: {
		label: "Trapper",
		// Two-piece OSA-style: body section + flared trap nose. Strokes overlap at the seam.
		guns: [
			{ length: 1.5, width: 0.7, x: -0.2, y: 0, angle: 0 },
			{ length: 0.3, width: 0.7, aspect: 1.7, x: 1.3, y: 0, angle: 0, shoot: { reload: 2.19, damage: 1.5, speed: 1.5, size: 1.7, range: 2.5, isTrap: true } },
		],
	},
	// OSA Class.director GUNS POSITION (/10): length 0.5, width 1.1, aspect 1.3, x 0.8.
	// PROPERTIES: SHOOT_SETTINGS = g.drone (reload 36, size 0.6, speed 1.5, spray 0.1),
	// TYPE: drone, AUTOFIRE: true, MAX_CHILDREN: 6, WAIT_TO_CYCLE: true.
	// Drones (Class.drone) carry BODY.DAMAGE 3.375, BODY.HEALTH 0.3, BODY.SPEED 3.8,
	// BODY.PENETRATION 1.2, BODY.RESIST 1.5, BUFF_VS_FOOD: true, RANGE 200.
	director: {
		label: "Director",
		// Director hangs back behind its swarm — keepout 250 (vs 30 for normal tanks)
		// is read by Tank.update's target-tracking distance logic.
		keepout: 250,
		guns: [
			{ length: 0.5, width: 1.1, aspect: 1.3, x: 0.8, y: 0, angle: 0, shoot: {
				isDrone: true,
				autoFire: true,
				reload: 3.43,        // OSA drone reload 36 vs basic 10.5 ≈ 3.43×.
				speed: 0.3,          // slow spawn velocity; drones accelerate via chase.
				damage: 4.5,         // OSA BODY.DAMAGE 3.375 / 0.75 base ≈ 4.5×.
				health: 2,           // 2× base bullet HP so drones survive a few hits.
				spray: 0.1,
				buffVsFood: true,    // OSA Class.drone BUFF_VS_FOOD: true.
				maxChildren: 6,      // OSA MAX_CHILDREN.
				droneMaxSpeed: 3,    // chase-mode top speed.
				droneAccel: 0.12,    // ≈ OSA ACCELERATION 0.085 in our scale.
				droneRange: 600,     // sight range for picking a target shape.
			} },
		],
	},
};

export const TIER_1_UPGRADES = ["twin", "sniper", "machineGun", "flankGuard", "pounder", "trapper", "director"];
