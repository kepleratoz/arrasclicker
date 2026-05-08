// All ratios pre-divided by 10 (matching OSA's mockupEntity.js where this.length = LENGTH/10).
// `shoot` is omitted for purely cosmetic guns (e.g. Trapper's body section).
// Stat multipliers (reload/damage/speed/size/range) are relative to Basic.
export const TANK_DEFS = {
	basic: {
		label: "Basic",
		guns: [{ length: 1.8, width: 0.8, x: 0, y: 0, angle: 0, shoot: {} }],
		upgrades: ["twin", "sniper", "machineGun", "flankGuard", "pounder", "trapper"],
	},
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
		guns: [{ length: 1.2, width: 1.0, aspect: 1.4, x: 0.8, y: 0, angle: 0, shoot: { reload: 0.5, damage: 0.7, size: 0.92 } }],
	},
	flankGuard: {
		label: "Flank Guard",
		guns: [
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: 0, shoot: {} },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (2 * Math.PI) / 3, shoot: { delay: 0.33 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (4 * Math.PI) / 3, shoot: { delay: 0.67 } },
		],
	},
	pounder: {
		label: "Pounder",
		guns: [{ length: 2.05, width: 1.2, x: 0, y: 0, angle: 0, shoot: { reload: 2, damage: 2, speed: 0.85, size: 1.2 } }],
	},
	trapper: {
		label: "Trapper",
		guns: [
			{ length: 1.5, width: 0.7, x: 0, y: 0, angle: 0 },
			{ length: 0.3, width: 0.7, aspect: 1.7, x: 1.5, y: 0, angle: 0, shoot: { reload: 2.19, damage: 1.5, speed: 0.65, size: 0.7, range: 0.6 } },
		],
	},
};

export const TIER_1_UPGRADES = ["twin", "sniper", "machineGun", "flankGuard", "pounder", "trapper"];
