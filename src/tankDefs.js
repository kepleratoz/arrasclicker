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
	// OSA Class.twin: combineStats([g.basic, g.twin]) — twin gunval has
	// damage 0.7, shudder 0.9, spray 1.2, health 0.9 (recoil 0.5 is cosmetic).
	// OSA Class.twin base + custom damage/health buffs (1.0 each).
	twin: {
		label: "Twin",
		upgrades: ["doubleTwin", "tripleShot", "gunner"],
		guns: [
			{ length: 2.0, width: 0.8, x: 0, y: 0.55, angle: 0, shoot: { damage: 1.0, health: 1.0, shudder: 0.9, spray: 1.2, delay: 0 } },
			{ length: 2.0, width: 0.8, x: 0, y: -0.55, angle: 0, shoot: { damage: 1.0, health: 1.0, shudder: 0.9, spray: 1.2, delay: 0.5 } },
		],
	},
	// OSA Class.doubleTwin = makeFlank('twin', 2, ...) — Twin's two barrels
	// duplicated and rotated 180°, producing 2 forward + 2 rearward barrels.
	// extraStats: [g.doubleTwin] adds damage 1.1 on top of twin's stats.
	doubleTwin: {
		label: "Double Twin",
		guns: [
			{ length: 2.0, width: 0.8, x: 0, y:  0.55, angle: 0,       shoot: { damage: 1.1, health: 1.0, shudder: 0.9, spray: 1.2, delay: 0 } },
			{ length: 2.0, width: 0.8, x: 0, y: -0.55, angle: 0,       shoot: { damage: 1.1, health: 1.0, shudder: 0.9, spray: 1.2, delay: 0.5 } },
			{ length: 2.0, width: 0.8, x: 0, y:  0.55, angle: Math.PI, shoot: { damage: 1.1, health: 1.0, shudder: 0.9, spray: 1.2, delay: 0 } },
			{ length: 2.0, width: 0.8, x: 0, y: -0.55, angle: Math.PI, shoot: { damage: 1.1, health: 1.0, shudder: 0.9, spray: 1.2, delay: 0.5 } },
		],
	},
	// OSA Class.tripleShot — centre barrel (LENGTH 22, WIDTH 8) plus two
	// mirrored flanking barrels (LENGTH 19, WIDTH 8, Y 2, ANGLE 18°, DELAY 0.5).
	// combineStats([g.basic, g.twin, g.tripleShot]) compounds twin (shudder 0.9,
	// spray 1.2) with tripleShot (reload 1.1, shudder 0.8, health 0.9, spray 0.5).
	tripleShot: {
		label: "Triple Shot",
		// Side barrels first so the centre (longer + same mount point) draws on
		// top, matching the OSA render order where the centre barrel sits over
		// the bases of the flanking pair.
		guns: [
			{ length: 1.9, width: 0.8, x: 0, y:  0.2, angle:  18 * Math.PI / 180, shoot: { reload: 1.1, damage: 1.0, health: 1.0, shudder: 0.72, spray: 0.6, delay: 0.5 } },
			{ length: 1.9, width: 0.8, x: 0, y: -0.2, angle: -18 * Math.PI / 180, shoot: { reload: 1.1, damage: 1.0, health: 1.0, shudder: 0.72, spray: 0.6, delay: 0.5 } },
			{ length: 2.2, width: 0.8, x: 0, y:  0,   angle: 0,                   shoot: { reload: 1.1, damage: 1.0, health: 1.0, shudder: 0.72, spray: 0.6, delay: 0 } },
		],
	},
	// OSA Class.sniper base + custom damage 1.5 and health 1.0.
	sniper: {
		label: "Sniper",
		guns: [{ length: 2.4, width: 0.8, x: 0, y: 0, angle: 0, shoot: { reload: 1.35, damage: 1.5, health: 1.0, speed: 1.5, shudder: 0.25, spray: 0.2 } }],
	},
	// OSA Class.machineGun base + custom damage 1.0 and health 1.0.
	machineGun: {
		label: "Machine Gun",
		upgrades: ["sprayer", "gunner"],
		guns: [{ length: 1.2, width: 1.0, aspect: 1.4, x: 0.8, y: 0, angle: 0, shoot: { reload: 0.5, damage: 1.0, speed: 0.8, size: 0.92, health: 1.0, spray: 2.5, shudder: 1.7 } }],
	},
	flankGuard: {
		label: "Flank Guard",
		upgrades: ["hexaTank"],
		guns: [
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: 0, shoot: { speed: 0.85 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (2 * Math.PI) / 3, shoot: { speed: 0.85, delay: 0.33 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (4 * Math.PI) / 3, shoot: { speed: 0.85, delay: 0.67 } },
		],
	},
	// OSA Class.hexaTank = makeFlank('basic', 6, "Hexa Tank",
	//   {extraStats: [g.flankGuard, g.flankGuard], delayIncrement: 0.5}).
	// Six basic barrels arrayed every 60°, alternating delay 0 / 0.5, with the
	// flankGuard gunval (speed 0.85, damage 0.81, health 1.02, pen 0.9) applied
	// twice — i.e. compounded: speed 0.72, damage 0.66, health 1.04.
	hexaTank: {
		label: "Hexa Tank",
		guns: [
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: 0,                       shoot: { speed: 0.72, damage: 0.66, health: 1.04, delay: 0 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (1 * Math.PI) / 3,       shoot: { speed: 0.72, damage: 0.66, health: 1.04, delay: 0.5 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (2 * Math.PI) / 3,       shoot: { speed: 0.72, damage: 0.66, health: 1.04, delay: 0 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (3 * Math.PI) / 3,       shoot: { speed: 0.72, damage: 0.66, health: 1.04, delay: 0.5 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (4 * Math.PI) / 3,       shoot: { speed: 0.72, damage: 0.66, health: 1.04, delay: 0 } },
			{ length: 1.8, width: 0.8, x: 0, y: 0, angle: (5 * Math.PI) / 3,       shoot: { speed: 0.72, damage: 0.66, health: 1.04, delay: 0.5 } },
		],
	},
	pounder: {
		label: "Pounder",
		upgrades: ["destroyer", "builder", "launcher"],
		// Pounder-line bullets are slow & heavy — hover at 100% of weapon range
		// so the AI keeps its arc lobbed across the field instead of charging
		// in to half-range.
		keepRangeMul: 1.0,
		guns: [{ length: 2.05, width: 1.2, x: 0, y: 0, angle: 0, shoot: { reload: 2, damage: 2, speed: 0.85, size: 1.2, health: 4 } }],
	},
	// OSA Class.destroyer — single LENGTH 20.5, WIDTH 14 barrel firing
	// combineStats([g.basic, g.pounder, g.destroyer]). g.destroyer adds reload
	// 2, damage 0.9, health 2, speed 0.5, shudder 0.5 on top of pounder's
	// gunval. Result: reload 4 (very slow), damage 1.8, health 8 (compounded
	// with the codebase's pounder x4 health buff), speed 0.425, shudder 0.5,
	// size kept at our pounder's 1.2.
	destroyer: {
		label: "Destroyer",
		keepRangeMul: 1.0,
		guns: [{ length: 2.05, width: 1.4, x: 0, y: 0, angle: 0, shoot: { reload: 4, damage: 1.8, speed: 0.425, size: 1.2, health: 8, shudder: 0.5 } }],
	},
	// OSA Class.gunner — weaponMirror([gunA, gunB], {delayIncrement: 0.25}).
	// gunA: LENGTH 12, WIDTH 3.5, Y 7.25, DELAY 0.5 (outer pair).
	// gunB: LENGTH 16, WIDTH 3.5, Y 3.75       (inner pair, longer).
	// SHOOT_SETTINGS: combineStats([g.basic, g.twin, g.gunner, {speed: 1.2}]).
	// g.gunner adds size 1.2, health 1.35, damage 0.25, shudder 1.5, spray 1.5,
	// maxSpeed 0.65 / speed 0.8 — compounded with twin's 0.7 damage, 0.9 health,
	// 0.9 shudder, 1.2 spray, and the +{speed: 1.2} on top.
	// Outer pair listed first so the longer inner barrels render on top — same
	// trick we used for Triple Shot's center.
	gunner: {
		label: "Gunner",
		guns: [
			{ length: 1.2, width: 0.35, x: 0, y:  0.725, angle: 0, shoot: { damage: 0.25, health: 1.35, speed: 0.96, size: 1.2, shudder: 1.35, spray: 1.8, delay: 0.5 } },
			{ length: 1.2, width: 0.35, x: 0, y: -0.725, angle: 0, shoot: { damage: 0.25, health: 1.35, speed: 0.96, size: 1.2, shudder: 1.35, spray: 1.8, delay: 0.75 } },
			{ length: 1.6, width: 0.35, x: 0, y:  0.375, angle: 0, shoot: { damage: 0.25, health: 1.35, speed: 0.96, size: 1.2, shudder: 1.35, spray: 1.8, delay: 0 } },
			{ length: 1.6, width: 0.35, x: 0, y: -0.375, angle: 0, shoot: { damage: 0.25, health: 1.35, speed: 0.96, size: 1.2, shudder: 1.35, spray: 1.8, delay: 0.25 } },
		],
	},
	// OSA Class.builder — Trapper-style two-piece body + trap nose, scaled up.
	// Body: LENGTH 18, WIDTH 12. Nose: LENGTH 2, WIDTH 12, ASPECT 1.1, X 18.
	// SHOOT_SETTINGS: combineStats([g.trap, g.setTrap]), TYPE: 'setTrap'.
	// g.setTrap adds reload 1.1, size 1.5, health 2, range 1.25 on top of
	// g.trap's reload 23, damage 0.75, size 0.7, speed 3.25.
	// Normalised to our scale (OSA reload / 10.5): reload 23 × 1.1 / 10.5 = 2.41.
	// Damage carries our Trapper-family ×2 buff (0.75 → 1.5). Bigger / tougher
	// trap than Trapper (size 2.0 vs 1.7, range 3.0 vs 2.5, health 2 vs 1).
	builder: {
		label: "Builder",
		keepRangeMul: 1.0,
		guns: [
			{ length: 1.8, width: 1.2, x: -0.2, y: 0, angle: 0 },
			{ length: 0.2, width: 1.2, aspect: 1.1, x: 1.6, y: 0, angle: 0, shoot: { reload: 2.41, damage: 1.5, speed: 1.0, size: 2.0, range: 3.0, health: 2, isTrap: true, trapSides: 4 } },
		],
	},
	// OSA Class.launcher — two-piece silhouette: tapered outer body section
	// (LENGTH 19.2, WIDTH 13, ASPECT 0.7) plus a uniform inner firing barrel
	// (LENGTH 17, WIDTH 13) drawn over it. The inner barrel shoots Class.minimissile
	// bullets (SHOOT_SETTINGS = combineStats([g.basic, g.pounder, g.launcher])).
	// Each missile then autofires its own rear-jet bullets every ~10 frames,
	// matching OSA Class.minimissile.GUNS[0] (combineStats([g.basic, {recoil:0.5}, g.lowPower])).
	// Body section listed first so the inner barrel paints over it.
	launcher: {
		label: "Launcher",
		keepRangeMul: 1.0,
		guns: [
			{ length: 1.92, width: 1.3, aspect: 0.7, x: 0, y: 0, angle: 0 },
			{ length: 1.7, width: 1.3, x: 0, y: 0, angle: 0, shoot: {
				// Compound stats normalised to our scale:
				// reload  : g.basic 10.5 × g.pounder 2 × g.launcher 1.5 / 10.5 = 3.0
				// damage  : our Pounder 2 × g.launcher 0.925 = 1.85
				// speed   : g.basic 5 × g.pounder 0.85 × g.launcher 0.9 / 5 = 0.765
				// size    : g.launcher 0.72
				// health  : our Pounder 4 × g.launcher 1.05 = 4.2
				// range   : g.launcher 1.1
				// shudder : g.pounder 1 × g.launcher 0.1 ≈ 0.01
				reload: 3.0,
				damage: 1.85,
				speed: 0.765,
				size: 0.72,
				health: 4.2,
				range: 1.1,
				shudder: 0.01,
				isMissile: true,
				// OSA minimissile rear-jet: combineStats([g.basic, {recoil: 0.5}, g.lowPower]).
				// damage 0.75 × 0.5 = 0.375; speed 5/5 = 1.0; health 1 × 0.5 = 0.5.
				missileSubCfg: { damage: 0.375, speed: 1.0, health: 0.5 },
				missileSubReload: 10,
				missileSubSizeMul: 0.55,
			} },
		],
	},
	// OSA Class.sprayer — Machine Gun base with a long thin pellet barrel laid
	// over the top. Outer (pellet) barrel: LENGTH 23, WIDTH 7, no offset, stats
	// combineStats([g.basic, g.machineGun, g.lowPower, g.pelleter, {recoil 1.15}]).
	// Inner (MG): LENGTH 12, WIDTH 10, ASPECT 1.4, X 8, stats combineStats([g.basic, g.machineGun]).
	// Outer reload normalised: 10.5 × 0.5 × 1 × 1.25 / 10.5 = 0.625.
	// Outer damage: g.machineGun 0.7 × g.lowPower 0.5 × g.pelleter 0.35 = 0.12.
	// Outer is listed first so the chunky MG barrel paints on top of its base.
	sprayer: {
		label: "Sprayer",
		guns: [
			{ length: 2.3, width: 0.7, x: 0,   y: 0, angle: 0, shoot: { reload: 0.625, damage: 0.2, speed: 0.9, size: 1.1, health: 0.35, shudder: 3.4, spray: 1.875 } },
			{ length: 1.2, width: 1.0, aspect: 1.4, x: 0.8, y: 0, angle: 0, shoot: { reload: 0.5, damage: 1.0, speed: 0.8, size: 0.92, health: 1.0, spray: 2.5, shudder: 1.7 } },
		],
	},
	// OSA Class.overseer — weaponMirror({POSITION: {LENGTH 6, WIDTH 12,
	// ASPECT 1.2, X 8, ANGLE 90}, ...}). The trick OSA's renderer plays is to
	// add POSITION.ANGLE into the mount direction too — `cos(direction + angle
	// + facing)` — so X 8, ANGLE 90 doesn't mean "forward mount, sideways
	// barrel" but "perpendicular mount, sideways barrel". Both guns end up on
	// the tank's sides, barrels pointing straight outward — Director rotated
	// 90° to the left, plus its backside-mirror twin.
	overseer: {
		label: "Overseer",
		keepout: 250,
		guns: [
			{ length: 0.6, width: 1.2, aspect: 1.2, x: 0, y:  0.8, angle:  Math.PI / 2, shoot: {
				isDrone: true,
				autoFire: true,
				reload: 4.29,
				speed: 0.3,
				damage: 3.6,
				health: 1.4,
				size: 0.85,
				spray: 0.1,
				buffVsFood: true,
				maxChildren: 4,
				droneMaxSpeed: 2.7,
				droneAccel: 0.12,
				droneRange: 600,
			} },
			{ length: 0.6, width: 1.2, aspect: 1.2, x: 0, y: -0.8, angle: -Math.PI / 2, shoot: {
				isDrone: true,
				autoFire: true,
				reload: 4.29,
				speed: 0.3,
				damage: 3.6,
				health: 1.4,
				size: 0.85,
				spray: 0.1,
				buffVsFood: true,
				maxChildren: 4,
				droneMaxSpeed: 2.7,
				droneAccel: 0.12,
				droneRange: 600,
			} },
		],
	},
	trapper: {
		label: "Trapper",
		upgrades: ["builder"],
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
		upgrades: ["overseer"],
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
