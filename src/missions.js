/**
 * ENDLESS — Calibration Missions
 * State machine for the 4 calibration missions that profile the player.
 *
 * 1. The Fork — split path, log choice + hesitation
 * 2. The Abandon — mid-mission exit, log push-through vs leave
 * 3. The Scarcity — limited resources, log hoarding vs spending
 * 4. The Confrontation — entity blocks path, log engage vs avoid
 */

import { send } from "./socket.js";
import { serializeState, serializeCalibrationSummary } from "./serializer.js";
import {
  recordDecision,
  spendResource,
  startHesitation,
  endHesitation,
  setActiveMission,
  completeMission,
} from "./playerModel.js";

// Mission phases
const PHASES = [
  "waiting",
  "the_fork",
  "the_abandon",
  "the_scarcity",
  "the_confrontation",
  "complete",
];

let currentPhaseIndex = 0;
let missionState = {};
let playerModelRef = null;
let gameRef = null;
let calibrationResults = {};

// Timing
let phaseStartTime = 0;
let transitionTimer = null;

export function initMissions(playerModel, game) {
  playerModelRef = playerModel;
  gameRef = game;
  currentPhaseIndex = 0;
  calibrationResults = {};
  missionState = {};
}

export function getCurrentPhase() {
  return PHASES[currentPhaseIndex] || "complete";
}

export function isCalibrationComplete() {
  return currentPhaseIndex >= PHASES.length - 1;
}

export function startCalibration() {
  currentPhaseIndex = 1; // skip 'waiting'
  setupPhase();
}

function setupPhase() {
  const phase = getCurrentPhase();
  phaseStartTime = Date.now();
  missionState = {};

  switch (phase) {
    case "the_fork":
      setupTheFork();
      break;
    case "the_abandon":
      setupTheAbandon();
      break;
    case "the_scarcity":
      setupTheScarcity();
      break;
    case "the_confrontation":
      setupTheConfrontation();
      break;
    case "complete":
      onCalibrationComplete();
      break;
  }
}

function advancePhase() {
  currentPhaseIndex++;
  if (transitionTimer) clearTimeout(transitionTimer);

  // Brief pause between phases
  transitionTimer = setTimeout(() => {
    setupPhase();
  }, 1500);
}

// ─── THE FORK ──────────────────────────────────────────────────────────────
// Two paths diverge. Which does the player take, and how long do they hesitate?

function setupTheFork() {
  setActiveMission(playerModelRef, {
    title: "The Fork",
    objective: "Two paths diverge ahead. Choose one.",
    type: "calibration",
  });

  // Place two path markers
  const cx = gameRef.canvas.width / 2;
  const cy = gameRef.canvas.height / 2;

  gameRef.calibrationObjects = [
    {
      id: "fork_left",
      type: "path_marker",
      x: cx - 160,
      y: cy - 80,
      radius: 40,
      label: "◀ darker path",
      color: "#2a1845",
      glowColor: "rgba(90, 50, 160, 0.4)",
    },
    {
      id: "fork_right",
      type: "path_marker",
      x: cx + 160,
      y: cy - 80,
      radius: 40,
      label: "brighter path ▶",
      color: "#1a3a45",
      glowColor: "rgba(50, 140, 160, 0.4)",
    },
  ];

  startHesitation(playerModelRef, "fork");
  updateMissionUI("The Fork", "Two paths diverge ahead. Choose one.");
  showCalibrationNarration("Two paths open before you. Neither reveals where it leads.");
}

export function handleForkChoice(choiceId) {
  if (getCurrentPhase() !== "the_fork" || missionState.resolved) return;
  missionState.resolved = true;

  const hesitationTime = endHesitation(playerModelRef, "fork");
  const choice = choiceId === "fork_left" ? "darker path" : "brighter path";

  calibrationResults.the_fork = {
    choice,
    hesitationTime,
    choiceId,
  };

  recordDecision(playerModelRef, {
    type: "fork_choice",
    description: `Chose the ${choice} after ${hesitationTime.toFixed(1)}s`,
  });

  const snapshot = serializeState(playerModelRef, gameRef, {
    hesitationTime,
    choiceDescription: `Player chose the ${choice}.`,
  });

  send("calibration_event", {
    calibration_type: "the_fork",
    result: calibrationResults.the_fork,
  }, snapshot);

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);
  showCalibrationNarration(`You chose the ${choice}. Something noticed.`);
  advancePhase();
}

// ─── THE ABANDON ───────────────────────────────────────────────────────────
// Player is mid-objective. A subtle exit appears. Do they leave or stay?

function setupTheAbandon() {
  setActiveMission(playerModelRef, {
    title: "The Abandon",
    objective: "Reach the signal ahead.",
    type: "calibration",
  });

  const cx = gameRef.canvas.width / 2;
  const cy = gameRef.canvas.height / 2;

  // Main objective marker
  gameRef.calibrationObjects = [
    {
      id: "abandon_goal",
      type: "objective_marker",
      x: cx,
      y: 80,
      radius: 30,
      label: "the signal",
      color: "#3a2a55",
      glowColor: "rgba(120, 80, 200, 0.5)",
    },
    {
      id: "abandon_exit",
      type: "exit_marker",
      x: cx + 220,
      y: cy + 100,
      radius: 24,
      label: "",
      color: "#1a1a1f",
      glowColor: "rgba(60, 60, 80, 0.2)",
      subtle: true,
    },
  ];

  missionState.exitRevealed = false;
  missionState.exitRevealTime = null;

  // Reveal the exit subtly after player starts moving toward goal
  setTimeout(() => {
    if (getCurrentPhase() === "the_abandon" && !missionState.resolved) {
      missionState.exitRevealed = true;
      missionState.exitRevealTime = Date.now();
      const exitObj = gameRef.calibrationObjects.find(
        (o) => o.id === "abandon_exit"
      );
      if (exitObj) {
        exitObj.label = "an exit?";
        exitObj.glowColor = "rgba(80, 80, 100, 0.3)";
      }
    }
  }, 3000);

  updateMissionUI("The Abandon", "Reach the signal ahead.");
  showCalibrationNarration("A signal pulses in the distance. Move toward it.");
}

export function handleAbandonChoice(choiceId) {
  if (getCurrentPhase() !== "the_abandon" || missionState.resolved) return;
  missionState.resolved = true;

  const timeSpent = (Date.now() - phaseStartTime) / 1000;
  const abandoned = choiceId === "abandon_exit";

  calibrationResults.the_abandon = {
    abandoned,
    timeSpent,
    exitWasRevealed: missionState.exitRevealed,
  };

  recordDecision(playerModelRef, {
    type: "abandon_choice",
    description: abandoned
      ? `Abandoned the mission after ${timeSpent.toFixed(1)}s`
      : `Pushed through to goal after ${timeSpent.toFixed(1)}s`,
  });

  const snapshot = serializeState(playerModelRef, gameRef, {
    abandoned,
    pushedThrough: !abandoned,
  });

  send("calibration_event", {
    calibration_type: "the_abandon",
    result: calibrationResults.the_abandon,
  }, snapshot);

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);
  showCalibrationNarration(
    abandoned
      ? "You left. The signal fades — but it remembers."
      : "You pressed on. Persistence is its own kind of answer."
  );
  advancePhase();
}

// ─── THE SCARCITY ──────────────────────────────────────────────────────────
// Limited resource. Nodes to spend on. Do they hoard or spend?

function setupTheScarcity() {
  playerModelRef.resources.current = 5;
  playerModelRef.resources.max = 5;

  setActiveMission(playerModelRef, {
    title: "The Scarcity",
    objective: "You have limited energy. Spend it wisely — or don't.",
    type: "calibration",
  });

  const cx = gameRef.canvas.width / 2;
  const cy = gameRef.canvas.height / 2;

  // Create energy nodes to interact with
  gameRef.calibrationObjects = [
    {
      id: "scarcity_node_1",
      type: "energy_node",
      x: cx - 140,
      y: cy - 60,
      radius: 28,
      label: "consume (−1)",
      color: "#3a1a45",
      glowColor: "rgba(160, 60, 180, 0.4)",
      cost: 1,
      consumed: false,
    },
    {
      id: "scarcity_node_2",
      type: "energy_node",
      x: cx + 140,
      y: cy - 60,
      radius: 28,
      label: "consume (−1)",
      color: "#3a1a45",
      glowColor: "rgba(160, 60, 180, 0.4)",
      cost: 1,
      consumed: false,
    },
    {
      id: "scarcity_node_3",
      type: "energy_node",
      x: cx,
      y: cy + 100,
      radius: 28,
      label: "consume (−2)",
      color: "#451a3a",
      glowColor: "rgba(180, 60, 140, 0.4)",
      cost: 2,
      consumed: false,
    },
    {
      id: "scarcity_done",
      type: "proceed_marker",
      x: cx,
      y: 60,
      radius: 30,
      label: "move on",
      color: "#1a2a3a",
      glowColor: "rgba(60, 100, 160, 0.3)",
    },
  ];

  missionState.resourcesSpent = 0;
  missionState.nodesConsumed = 0;
  updateResourceUI();

  updateMissionUI("The Scarcity", "You have limited energy. Spend it — or conserve it.");
  showCalibrationNarration(
    "Your energy is finite here. Each node costs something. You can move on at any time."
  );
}

export function handleScarcityInteraction(objectId) {
  if (getCurrentPhase() !== "the_scarcity" || missionState.resolved) return;

  if (objectId === "scarcity_done") {
    missionState.resolved = true;
    finishScarcity();
    return;
  }

  const node = gameRef.calibrationObjects.find((o) => o.id === objectId);
  if (!node || node.consumed || node.type !== "energy_node") return;

  if (playerModelRef.resources.current < node.cost) {
    showCalibrationNarration("Not enough energy.");
    return;
  }

  node.consumed = true;
  node.color = "#0a0a10";
  node.glowColor = "rgba(40, 40, 50, 0.1)";
  node.label = "depleted";

  spendResource(playerModelRef, node.cost);
  missionState.resourcesSpent += node.cost;
  missionState.nodesConsumed++;
  updateResourceUI();

  // Auto-finish if all resources spent or all nodes consumed
  const allConsumed = gameRef.calibrationObjects
    .filter((o) => o.type === "energy_node")
    .every((o) => o.consumed);

  if (allConsumed || playerModelRef.resources.current <= 0) {
    setTimeout(() => {
      if (!missionState.resolved) {
        missionState.resolved = true;
        finishScarcity();
      }
    }, 1000);
  }
}

function finishScarcity() {
  const strategy =
    missionState.resourcesSpent === 0
      ? "full_hoard"
      : missionState.resourcesSpent >= 4
        ? "free_spender"
        : "cautious";

  calibrationResults.the_scarcity = {
    resourcesSpent: missionState.resourcesSpent,
    resourcesAvailable: 5,
    nodesConsumed: missionState.nodesConsumed,
    strategy,
  };

  recordDecision(playerModelRef, {
    type: "scarcity_choice",
    description: `Spent ${missionState.resourcesSpent}/5 energy (${strategy})`,
  });

  const snapshot = serializeState(playerModelRef, gameRef, {
    resourcesSpent: missionState.resourcesSpent,
  });

  send("calibration_event", {
    calibration_type: "the_scarcity",
    result: calibrationResults.the_scarcity,
  }, snapshot);

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);

  // Reset resources for future use
  playerModelRef.resources.current = 10;
  playerModelRef.resources.max = 10;
  updateResourceUI();

  showCalibrationNarration(
    strategy === "full_hoard"
      ? "You kept everything. What are you saving it for?"
      : strategy === "free_spender"
        ? "You gave freely. Generosity — or recklessness?"
        : "Measured. Careful. The void notes your precision."
  );
  advancePhase();
}

// ─── THE CONFRONTATION ─────────────────────────────────────────────────────
// Entity blocks the path. Engage or avoid?

function setupTheConfrontation() {
  setActiveMission(playerModelRef, {
    title: "The Confrontation",
    objective: "Something blocks your way forward.",
    type: "calibration",
  });

  const cx = gameRef.canvas.width / 2;
  const cy = gameRef.canvas.height / 2;

  gameRef.calibrationObjects = [
    {
      id: "confrontation_entity",
      type: "blocker_entity",
      x: cx,
      y: cy - 40,
      radius: 45,
      label: "",
      color: "#4a1a1a",
      glowColor: "rgba(200, 60, 60, 0.5)",
      pulseSpeed: 0.03,
    },
    {
      id: "confrontation_engage",
      type: "engage_marker",
      x: cx,
      y: cy - 40,
      radius: 55,
      label: "approach",
      color: "transparent",
      glowColor: "rgba(200, 80, 80, 0.2)",
    },
    {
      id: "confrontation_avoid",
      type: "avoid_marker",
      x: cx + 240,
      y: cy + 60,
      radius: 30,
      label: "go around",
      color: "#1a1a2a",
      glowColor: "rgba(60, 60, 120, 0.3)",
      subtle: true,
    },
  ];

  startHesitation(playerModelRef, "confrontation");
  updateMissionUI("The Confrontation", "Something blocks your way.");
  showCalibrationNarration(
    "A presence stands before you, unmoving. It does not speak. It waits."
  );
}

export function handleConfrontationChoice(choiceId) {
  if (getCurrentPhase() !== "the_confrontation" || missionState.resolved) return;
  missionState.resolved = true;

  const approachTime = endHesitation(playerModelRef, "confrontation");
  const engaged = choiceId === "confrontation_engage";

  calibrationResults.the_confrontation = {
    engaged,
    approachTime,
  };

  recordDecision(playerModelRef, {
    type: "confrontation_choice",
    description: engaged
      ? `Engaged the entity after ${approachTime.toFixed(1)}s`
      : `Avoided the entity after ${approachTime.toFixed(1)}s`,
  });

  const snapshot = serializeState(playerModelRef, gameRef, {
    engaged,
    avoided: !engaged,
    approachTime,
  });

  send("calibration_event", {
    calibration_type: "the_confrontation",
    result: calibrationResults.the_confrontation,
  }, snapshot);

  gameRef.calibrationObjects = [];
  completeMission(playerModelRef);
  showCalibrationNarration(
    engaged
      ? "You faced it. It dissolves — but it felt you first."
      : "You went around. Avoidance is also an answer the void remembers."
  );
  advancePhase();
}

// ─── CALIBRATION COMPLETE ──────────────────────────────────────────────────

function onCalibrationComplete() {
  const summary = serializeCalibrationSummary(calibrationResults);

  send("calibration_complete", { results: calibrationResults }, summary);

  playerModelRef.status = "adaptive";
  updateStatusUI("the void is watching");

  showCalibrationNarration(
    "Calibration complete. The world now knows your shape. It begins to change."
  );
  updateMissionUI("—", "Awaiting the world's response...");
}

// ─── Collision Check (called from game loop) ───────────────────────────────

export function checkCalibrationCollisions(playerX, playerY) {
  const phase = getCurrentPhase();
  if (phase === "waiting" || phase === "complete") return;

  for (const obj of gameRef.calibrationObjects) {
    const dx = playerX - obj.x;
    const dy = playerY - obj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < obj.radius + 12) {
      switch (phase) {
        case "the_fork":
          if (obj.id === "fork_left" || obj.id === "fork_right") {
            handleForkChoice(obj.id);
          }
          break;
        case "the_abandon":
          if (obj.id === "abandon_goal" || obj.id === "abandon_exit") {
            handleAbandonChoice(obj.id);
          }
          break;
        case "the_scarcity":
          handleScarcityInteraction(obj.id);
          break;
        case "the_confrontation":
          if (
            obj.id === "confrontation_engage" ||
            obj.id === "confrontation_avoid"
          ) {
            handleConfrontationChoice(obj.id);
          }
          break;
      }
    }
  }
}

// ─── UI Helpers ────────────────────────────────────────────────────────────

function updateMissionUI(title, objective) {
  const content = document.getElementById("active-mission-content");
  if (content) {
    content.innerHTML = `<strong>${title}</strong><br/>${objective}`;
  }

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

function updateResourceUI() {
  const bar = document.getElementById("resource-bar");
  const text = document.getElementById("resource-text");
  if (bar) {
    const pct =
      (playerModelRef.resources.current / playerModelRef.resources.max) * 100;
    bar.style.setProperty("--energy-pct", `${pct}%`);
  }
  if (text) {
    text.textContent = `${playerModelRef.resources.current}/${playerModelRef.resources.max}`;
  }
}

function updateStatusUI(status) {
  const el = document.getElementById("status-text");
  if (el) el.textContent = status;
}

function showCalibrationNarration(message) {
  // Import will be resolved at runtime
  const { addLogEntry, showNarration } = require_main();
  showNarration(message, 4000);
  addLogEntry(message, "narration");
}

// Lazy import to avoid circular deps
let _mainModule = null;
function require_main() {
  if (!_mainModule) {
    _mainModule = {
      addLogEntry: window.__endless_addLogEntry,
      showNarration: window.__endless_showNarration,
    };
  }
  return _mainModule;
}

export function getCalibrationResults() {
  return calibrationResults;
}
