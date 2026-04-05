/**
 * ENDLESS — Calibration Missions (Survival RPG version)
 *
 * Mission 1 — The Fork: two paths, risk appetite
 * Mission 2 — The Drain: slow-drain field with net-positive center
 * Mission 3 — The Hoard: 3 upgrade orbs, pick 2
 * Mission 4 — The Presence: entity drifts toward player
 */

import { send } from "./socket.js";
import { serializeState, serializeCalibrationSummary } from "./serializer.js";
import {
  recordDecision, startHesitation, endHesitation, setActiveMission,
  completeMission, applySpeedUpgrade, applySightUpgrade, applyMemoryUpgrade,
} from "./playerModel.js";

const PHASES = ["waiting", "the_fork", "the_drain", "the_hoard", "the_presence", "complete"];
let currentPhaseIndex = 0;
let missionState = {};
let playerModelRef = null;
let gameRef = null;
let calibrationResults = {};
let phaseStartTime = 0;
let transitionTimer = null;

export function initMissions(playerModel, game) {
  playerModelRef = playerModel;
  gameRef = game;
  currentPhaseIndex = 0;
  calibrationResults = {};
  missionState = {};
}

export function getCurrentPhase() { return PHASES[currentPhaseIndex] || "complete"; }
export function isCalibrationComplete() { return currentPhaseIndex >= PHASES.length - 1; }
export function getCalibrationResults() { return calibrationResults; }

export function startCalibration() {
  currentPhaseIndex = 1;
  setupPhase();
}

function setupPhase() {
  const phase = getCurrentPhase();
  phaseStartTime = Date.now();
  missionState = {};
  gameRef.calibrationObjects = [];

  switch (phase) {
    case "the_fork": setupTheFork(); break;
    case "the_drain": setupTheDrain(); break;
    case "the_hoard": setupTheHoard(); break;
    case "the_presence": setupThePresence(); break;
    case "complete": onCalibrationComplete(); break;
  }
}

function advancePhase() {
  currentPhaseIndex++;
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => setupPhase(), 1800);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION 1 — THE FORK
// Two paths diverge. Left = safe/warm. Right = dark but shimmer of value.
// ═══════════════════════════════════════════════════════════════════════════

function setupTheFork() {
  setActiveMission(playerModelRef, {
    title: "The Fork", objective: "Two paths. Choose one.", type: "calibration",
  });

  const px = gameRef.player.x;
  const py = gameRef.player.y;

  gameRef.calibrationObjects = [
    {
      id: "fork_left", type: "path_marker",
      x: px - 180, y: py - 120, radius: 35,
      label: "warm glow ahead",
      color: "#3a2a0a", glowColor: "rgba(232, 168, 76, 0.35)",
    },
    {
      id: "fork_right", type: "path_marker",
      x: px + 180, y: py - 120, radius: 35,
      label: "something glints...",
      color: "#1a1a28", glowColor: "rgba(94, 196, 182, 0.2)",
      subtle: true,
    },
  ];

  missionState.backtracked = false;
  missionState.firstApproach = null;
  startHesitation(playerModelRef, "fork");
  showUI("The Fork", "Two paths diverge. Neither tells you where it leads.");
  narrate("Two paths open before you. One glows faintly with warmth. The other shimmers — darker, uncertain.");
}

export function checkCalibrationCollisions(px, py) {
  const phase = getCurrentPhase();
  if (phase === "waiting" || phase === "complete") return;

  for (const obj of gameRef.calibrationObjects) {
    const dist = Math.sqrt((px - obj.x) ** 2 + (py - obj.y) ** 2);

    // Track first approach for fork
    if (phase === "the_fork" && dist < obj.radius + 40 && !missionState.firstApproach) {
      missionState.firstApproach = obj.id;
    }

    if (dist < (obj.radius || 25) + 10) {
      switch (phase) {
        case "the_fork":
          if (obj.id === "fork_left" || obj.id === "fork_right") resolveTheFork(obj.id);
          break;
        case "the_drain":
          if (obj.id === "drain_center") resolveTheDrain(true);
          break;
        case "the_hoard":
          if (obj.type === "upgrade_orb" && !obj.taken) pickUpOrb(obj);
          break;
        case "the_presence":
          if (obj.id === "presence_entity") resolveThePresence("engage");
          break;
      }
    }
  }

  // Drain field check (continuous, not just on collision)
  if (phase === "the_drain" && !missionState.resolved) {
    checkDrainField(px, py);
  }

  // Presence avoidance check
  if (phase === "the_presence" && !missionState.resolved) {
    updatePresence();
  }
}

function resolveTheFork(choiceId) {
  if (getCurrentPhase() !== "the_fork" || missionState.resolved) return;
  missionState.resolved = true;

  const hesitationTime = endHesitation(playerModelRef, "fork");
  const choice = choiceId === "fork_left" ? "warm path (safe)" : "dark path (risky)";
  const firstLook = missionState.firstApproach === "fork_left" ? "warm path" : "dark path";

  calibrationResults.the_fork = {
    choice, choiceId, hesitationTime, firstLook,
    backtracked: missionState.backtracked,
    riskAppetite: choiceId === "fork_right" ? "high" : "low",
  };

  recordDecision(playerModelRef, {
    type: "fork_choice",
    description: `Chose the ${choice} after ${hesitationTime.toFixed(1)}s. First looked at ${firstLook}.`,
  });

  send("calibration_event", {
    calibration_type: "the_fork",
    result: calibrationResults.the_fork,
  }, serializeState(playerModelRef, gameRef, { hesitationTime, choiceDescription: `Chose ${choice}.` }));

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);
  narrate(choiceId === "fork_right"
    ? "You chose the unknown. Something in the dark took notice."
    : "You chose warmth. The familiar path. Something out there will remember what you avoided.");
  advancePhase();
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION 2 — THE DRAIN
// Slow-drain field with a net-positive energy source in the center.
// ═══════════════════════════════════════════════════════════════════════════

function setupTheDrain() {
  setActiveMission(playerModelRef, {
    title: "The Drain", objective: "A high-value energy source sits inside a drain field.", type: "calibration",
  });

  const px = gameRef.player.x + 60;
  const py = gameRef.player.y - 80;

  missionState.drainField = {
    x: px, y: py, radius: 150,
    drainRate: 1.5, // energy/second inside
  };

  // The center energy source — worth MORE than the drain cost
  gameRef.calibrationObjects = [
    {
      id: "drain_center", type: "energy_source",
      x: px, y: py, radius: 20,
      label: "+35 energy",
      color: "#3a2a0a", glowColor: "rgba(232, 168, 76, 0.5)",
    },
  ];

  missionState.enteredField = false;
  missionState.edgeHoverStart = null;
  missionState.timeInField = 0;
  missionState.energyLostInField = 0;
  startHesitation(playerModelRef, "drain");
  showUI("The Drain", "An energy source sits inside a drain field. Is it worth the cost?");
  narrate("A drain field surrounds a bright energy source. Walking through costs energy — but the center promises to give back more.");

  // Auto-resolve after 25 seconds if player never enters
  missionState.timeout = setTimeout(() => {
    if (!missionState.resolved) resolveTheDrain(false);
  }, 25000);
}

function checkDrainField(px, py) {
  const field = missionState.drainField;
  if (!field) return;

  const dist = Math.sqrt((px - field.x) ** 2 + (py - field.y) ** 2);

  // Track hovering at edge
  if (dist < field.radius + 30 && dist > field.radius && !missionState.edgeHoverStart) {
    missionState.edgeHoverStart = Date.now();
  }

  // Inside the drain field
  if (dist < field.radius) {
    if (!missionState.enteredField) {
      missionState.enteredField = true;
      missionState.fieldEntryTime = Date.now();
    }
    // Drain energy (called every frame, so use per-frame drain)
    const drain = field.drainRate / 60; // assuming ~60fps
    playerModelRef.energy = Math.max(1, playerModelRef.energy - drain); // don't kill during calibration
    missionState.energyLostInField += drain;
    missionState.timeInField += 1/60;
  }
}

function resolveTheDrain(reachedCenter) {
  if (getCurrentPhase() !== "the_drain" || missionState.resolved) return;
  missionState.resolved = true;
  if (missionState.timeout) clearTimeout(missionState.timeout);

  const hesitationTime = endHesitation(playerModelRef, "drain");
  const edgeHoverTime = missionState.edgeHoverStart
    ? (Date.now() - missionState.edgeHoverStart) / 1000 : 0;

  if (reachedCenter) {
    // Net positive reward
    playerModelRef.energy = Math.min(playerModelRef.maxEnergy, playerModelRef.energy + 35);
  }

  calibrationResults.the_drain = {
    enteredField: missionState.enteredField,
    reachedCenter,
    hesitationTime,
    edgeHoverTime,
    timeInField: missionState.timeInField,
    energyLost: missionState.energyLostInField,
    lossTolerance: reachedCenter ? "high" : missionState.enteredField ? "medium" : "low",
  };

  recordDecision(playerModelRef, {
    type: "drain_choice",
    description: reachedCenter
      ? `Entered drain field and reached the center. Lost ${missionState.energyLostInField.toFixed(1)} energy, gained 35.`
      : `${missionState.enteredField ? "Entered but didn't reach center" : "Avoided the drain field entirely"}.`,
  });

  send("calibration_event", {
    calibration_type: "the_drain",
    result: calibrationResults.the_drain,
  }, serializeState(playerModelRef, gameRef, {
    choiceDescription: reachedCenter
      ? "Player crossed the drain field to collect the reward."
      : "Player avoided or couldn't complete the drain field.",
  }));

  gameRef.calibrationObjects = [];
  missionState.drainField = null;
  completeMission(playerModelRef);

  narrate(reachedCenter
    ? "You pushed through the cost. The reward was real — and the world noted your tolerance for pain."
    : missionState.enteredField
      ? "You entered but turned back. The cost felt too high, even if the math disagreed."
      : "You stayed outside. Sometimes the smartest move is the one that feels least brave.");
  advancePhase();
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION 3 — THE HOARD
// Three upgrade orbs, player can only carry two.
// ═══════════════════════════════════════════════════════════════════════════

function setupTheHoard() {
  setActiveMission(playerModelRef, {
    title: "The Hoard", objective: "Three upgrades. You can only carry two. Choose wisely.", type: "calibration",
  });

  const px = gameRef.player.x;
  const py = gameRef.player.y;

  gameRef.calibrationObjects = [
    {
      id: "orb_speed", type: "upgrade_orb",
      x: px - 100, y: py - 100, radius: 22,
      label: "SPEED +0.5",
      color: "#1a3a20", glowColor: "rgba(94, 196, 120, 0.35)",
      upgrade: { type: "speed", amount: 0.5 },
      taken: false, known: true,
    },
    {
      id: "orb_unknown_1", type: "upgrade_orb",
      x: px + 100, y: py - 100, radius: 22,
      label: "???",
      color: "#2a1a3a", glowColor: "rgba(160, 120, 200, 0.3)",
      upgrade: { type: "sight", amount: 30 },
      taken: false, known: false,
    },
    {
      id: "orb_unknown_2", type: "upgrade_orb",
      x: px, y: py - 180, radius: 22,
      label: "???",
      color: "#3a2a1a", glowColor: "rgba(200, 160, 100, 0.3)",
      upgrade: { type: "memory", amount: 0.25 },
      taken: false, known: false,
    },
  ];

  missionState.orbsTaken = 0;
  missionState.orbsChosen = [];
  missionState.orbLeft = null;
  startHesitation(playerModelRef, "hoard");
  showUI("The Hoard", "Three upgrade orbs. You can only carry two.");
  narrate("Three upgrades cluster ahead. One labeled, two unknown. You can only take two. Choose what to leave behind.");
}

function pickUpOrb(orb) {
  if (getCurrentPhase() !== "the_hoard" || orb.taken || missionState.resolved) return;

  if (missionState.orbsTaken >= 2) return; // already got two

  orb.taken = true;
  orb.color = "#0a0a0a";
  orb.glowColor = "rgba(40,40,40,0.1)";
  orb.label = "taken";
  missionState.orbsTaken++;
  missionState.orbsChosen.push({
    id: orb.id,
    upgrade: orb.upgrade,
    wasKnown: orb.known,
  });

  // Apply the upgrade
  switch (orb.upgrade.type) {
    case "speed": applySpeedUpgrade(playerModelRef, orb.upgrade.amount); break;
    case "sight": applySightUpgrade(playerModelRef, orb.upgrade.amount); break;
    case "memory": applyMemoryUpgrade(playerModelRef, orb.upgrade.amount); break;
  }

  narrate(orb.known
    ? `Speed +${orb.upgrade.amount}. You chose the known.`
    : `The orb reveals: ${orb.upgrade.type === "sight" ? "SIGHT +30" : "MEMORY +25%"}. The unknown had a gift.`);

  if (missionState.orbsTaken >= 2) {
    // Determine which orb was left
    const leftOrb = gameRef.calibrationObjects.find(o => o.type === "upgrade_orb" && !o.taken);
    missionState.orbLeft = leftOrb ? { id: leftOrb.id, upgrade: leftOrb.upgrade, wasKnown: leftOrb.known } : null;

    setTimeout(() => resolveTheHoard(), 1200);
  }
}

function resolveTheHoard() {
  if (missionState.resolved) return;
  missionState.resolved = true;

  const hesitationTime = endHesitation(playerModelRef, "hoard");
  const choseKnown = missionState.orbsChosen.some(o => o.wasKnown);
  const choseUnknowns = missionState.orbsChosen.filter(o => !o.wasKnown).length;

  calibrationResults.the_hoard = {
    orbsChosen: missionState.orbsChosen,
    orbLeft: missionState.orbLeft,
    hesitationTime,
    strategy: choseUnknowns === 2 ? "risk_taker" : choseUnknowns === 1 ? "balanced" : "certainty_seeker",
    leftKnown: missionState.orbLeft?.wasKnown || false,
  };

  recordDecision(playerModelRef, {
    type: "hoard_choice",
    description: `Took ${missionState.orbsChosen.map(o => o.upgrade.type).join(" + ")}, left ${missionState.orbLeft?.upgrade.type || "unknown"}.`,
  });

  send("calibration_event", {
    calibration_type: "the_hoard",
    result: calibrationResults.the_hoard,
  }, serializeState(playerModelRef, gameRef, {
    choiceDescription: `Chose ${missionState.orbsChosen.length} orbs, left one behind.`,
  }));

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);
  narrate("Two taken. One abandoned. The void notes what you considered worth keeping — and what you could let go.");
  advancePhase();
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION 4 — THE PRESENCE
// Entity drifts toward player. Engage, freeze, or flee.
// ═══════════════════════════════════════════════════════════════════════════

function setupThePresence() {
  setActiveMission(playerModelRef, {
    title: "The Presence", objective: "Something approaches from the edge of sight.", type: "calibration",
  });

  const px = gameRef.player.x;
  const py = gameRef.player.y;
  // Spawn far enough to give player time to decide
  const angle = Math.random() * Math.PI * 2;
  const spawnDist = playerModelRef.sightRadius + 60;

  gameRef.calibrationObjects = [
    {
      id: "presence_entity", type: "presence",
      x: px + Math.cos(angle) * spawnDist,
      y: py + Math.sin(angle) * spawnDist,
      radius: 30,
      label: "",
      color: "#2a1a1a", glowColor: "rgba(200, 100, 80, 0.4)",
      pulseSpeed: 0.025,
      speed: 0.8, // walking pace
    },
  ];

  missionState.firstSeen = null;
  missionState.playerPositions = [];
  missionState.initialPlayerPos = { x: px, y: py };
  startHesitation(playerModelRef, "presence");
  showUI("The Presence", "Something is moving toward you.");
  narrate("A presence emerges at the edge of your sight. It moves toward you — slowly, steadily. It is not aggressive. It is curious.");

  // Timeout as safety
  missionState.timeout = setTimeout(() => {
    if (!missionState.resolved) resolveThePresence("timeout");
  }, 20000);
}

function updatePresence() {
  const entity = gameRef.calibrationObjects.find(o => o.id === "presence_entity");
  if (!entity) return;

  // Move toward player
  const dx = gameRef.player.x - entity.x;
  const dy = gameRef.player.y - entity.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 15) {
    entity.x += (dx / dist) * entity.speed;
    entity.y += (dy / dist) * entity.speed;
  }

  // Track if player first sees it (within sight radius)
  if (!missionState.firstSeen && dist < playerModelRef.sightRadius) {
    missionState.firstSeen = Date.now();
  }

  // Track player movement pattern
  if (missionState.firstSeen) {
    missionState.playerPositions.push({ x: gameRef.player.x, y: gameRef.player.y, t: Date.now() });
  }

  // Check if player is fleeing (moving away significantly)
  if (missionState.firstSeen && missionState.playerPositions.length > 30) {
    const initial = missionState.initialPlayerPos;
    const current = { x: gameRef.player.x, y: gameRef.player.y };
    const movedAway = Math.sqrt((current.x - entity.x) ** 2 + (current.y - entity.y) ** 2);
    const initialDist = Math.sqrt((initial.x - entity.x) ** 2 + (initial.y - entity.y) ** 2);

    if (movedAway > initialDist + 80) {
      resolveThePresence("flee");
    }
  }

  // Check freeze (player hasn't moved much since seeing it)
  if (missionState.firstSeen && missionState.playerPositions.length > 60) {
    const recent = missionState.playerPositions.slice(-60);
    const totalMovement = recent.reduce((sum, p, i) => {
      if (i === 0) return 0;
      return sum + Math.sqrt((p.x - recent[i-1].x)**2 + (p.y - recent[i-1].y)**2);
    }, 0);
    if (totalMovement < 15 && (Date.now() - missionState.firstSeen) > 3000) {
      resolveThePresence("freeze");
    }
  }
}

function resolveThePresence(behavior) {
  if (getCurrentPhase() !== "the_presence" || missionState.resolved) return;
  missionState.resolved = true;
  if (missionState.timeout) clearTimeout(missionState.timeout);

  const hesitationTime = endHesitation(playerModelRef, "presence");
  const responseTime = missionState.firstSeen ? (Date.now() - missionState.firstSeen) / 1000 : hesitationTime;

  calibrationResults.the_presence = {
    behavior, // "engage", "flee", "freeze", "timeout"
    responseTime,
    hesitationTime,
    confrontationInstinct: behavior === "engage" ? "approach" : behavior === "flee" ? "avoid" : "freeze",
  };

  recordDecision(playerModelRef, {
    type: "presence_choice",
    description: `${behavior === "engage" ? "Approached" : behavior === "flee" ? "Fled from" : "Froze before"} the presence after ${responseTime.toFixed(1)}s.`,
  });

  send("calibration_event", {
    calibration_type: "the_presence",
    result: calibrationResults.the_presence,
  }, serializeState(playerModelRef, gameRef, {
    choiceDescription: `Player ${behavior === "engage" ? "approached" : behavior === "flee" ? "fled from" : "froze before"} the entity.`,
  }));

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);

  const messages = {
    engage: "You walked toward it. Face to face, it dissolved — but it felt your heat first.",
    flee: "You ran. The presence fades behind you, but its trajectory is now part of your map.",
    freeze: "You froze. The presence circled you once, then drifted away. Stillness is also a choice.",
    timeout: "Time passed. The presence arrived, and passed through you like smoke. You felt nothing. Or everything.",
  };
  narrate(messages[behavior] || messages.timeout);
  advancePhase();
}

// ═══════════════════════════════════════════════════════════════════════════
// CALIBRATION COMPLETE
// ═══════════════════════════════════════════════════════════════════════════

function onCalibrationComplete() {
  const summary = serializeCalibrationSummary(calibrationResults);

  send("calibration_complete", { results: calibrationResults }, summary);

  playerModelRef.status = "adaptive";
  updateStatusUI("the world is watching");

  narrate("Calibration complete. The world now knows your shape. It begins to change.");
  showUI("—", "Awaiting the world's response...");
}

// ═══════════════════════════════════════════════════════════════════════════
// DRAIN FIELD RENDERING BRIDGE
// ═══════════════════════════════════════════════════════════════════════════

export function getDrainField() {
  return missionState.drainField || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function showUI(title, objective) {
  const content = document.getElementById("active-mission-content");
  if (content) content.innerHTML = `<strong>${title}</strong><br/>${objective}`;

  const promptEl = document.getElementById("mission-prompt");
  const titleEl = document.getElementById("mission-prompt-title");
  const objEl = document.getElementById("mission-prompt-objective");
  if (promptEl && titleEl && objEl) {
    titleEl.textContent = title;
    objEl.textContent = objective;
    promptEl.classList.remove("hidden");
    setTimeout(() => promptEl.classList.add("hidden"), 5000);
  }
}

function updateStatusUI(status) {
  const el = document.getElementById("status-text");
  if (el) el.textContent = status;
}

function narrate(message) {
  window.__endless_showNarration?.(message, 4500);
  window.__endless_addLogEntry?.(message, "narration");
}
