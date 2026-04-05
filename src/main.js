/**
 * ENDLESS — Main Entry Point
 * Game loop: energy drain, fog of war, calibration, post-calibration adaptive loop, game over.
 */

import { createGame, updateGame, renderGame, renderDrainField, spawnEnergyNode } from "./game.js";
import { createPlayerModel, drainEnergy, collectEnergy, recordDecision, getSessionSummary } from "./playerModel.js";
import { connect, send, isConnected } from "./socket.js";
import { executeCommands, initExecutor } from "./executor.js";
import {
  initMissions, startCalibration, checkCalibrationCollisions,
  isCalibrationComplete, getCurrentPhase, getDrainField,
} from "./missions.js";
import { serializeState } from "./serializer.js";

// ─── State ──────────────────────────────────────────────────────────────────

let game = null;
let playerModel = null;
let lastFrame = 0;
let started = false;
let sessionId = null;
let gameOverShown = false;

// Post-calibration tracking
let lastZone = "unknown";
let lastProximityEvent = 0;
let lastAmbientPulse = 0;
let lastMissionCheck = 0;
let explorationTracker = { zonesVisited: new Set(), distanceTraveled: 0, lastPos: null };

const PROXIMITY_COOLDOWN = 8000;
const AMBIENT_PULSE_INTERVAL = 35000;
const MISSION_CHECK_INTERVAL = 2000;

// ─── Expose globally ────────────────────────────────────────────────────────

window.__endless_addLogEntry = addLogEntry;
window.__endless_showNarration = showNarration;

// ─── Init ───────────────────────────────────────────────────────────────────

function init() {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;

  game = createGame(canvas);
  playerModel = createPlayerModel();
  playerModel.position = { x: game.player.x, y: game.player.y };

  initExecutor(game);
  initMissions(playerModel, game);
  connect(onServerMessage);

  updateHUD();
  addLogEntry("Establishing connection...", "system");

  // Restart button
  document.getElementById("game-over-restart")?.addEventListener("click", () => {
    location.reload();
  });

  requestAnimationFrame(gameLoop);
}

// ─── Server Messages ────────────────────────────────────────────────────────

function onServerMessage(data) {
  switch (data.type) {
    case "session_init":
      sessionId = data.session_id;
      addLogEntry("Connected to the world.", "system");
      addLogEntry(data.message || "", "narration");
      updateStatus("calibrating");
      setTimeout(() => {
        if (!started) {
          started = true;
          startCalibration();
          addLogEntry("Calibration initiated.", "system");
        }
      }, 1500);
      break;

    case "commands":
      if (data.commands && Array.isArray(data.commands)) {
        executeCommands(data.commands);
        playerModel.sessionDepth++;
        updateDepth(playerModel.sessionDepth);
      }
      break;

    case "ack":
      break;
  }
}

// ─── Game Loop ──────────────────────────────────────────────────────────────

function gameLoop(timestamp) {
  if (!lastFrame) lastFrame = timestamp;
  const dt = timestamp - lastFrame;
  lastFrame = timestamp;

  if (!game.gameOver) {
    // Update game world
    updateGame(game, playerModel, dt);

    // Energy drain
    updateEnergyDrain(dt);

    // Energy node collection
    checkEnergyCollection();

    // Mission checks
    if (!isCalibrationComplete()) {
      checkCalibrationCollisions(game.player.x, game.player.y);
    } else {
      checkZoneTransitions();
      checkEntityProximity();
      checkMissionProximity();
      checkAmbientPulse();
      trackExploration();
    }

    // Check game over
    if (playerModel.energy <= 0 && playerModel.alive) {
      triggerGameOver();
    }
  }

  // Render
  renderGame(game, playerModel);

  // Render drain field overlay on top if active (during calibration)
  if (getCurrentPhase() === "the_drain") {
    const field = getDrainField();
    if (field) {
      game.ctx.save();
      game.ctx.translate(-game.camera.x, -game.camera.y);
      renderDrainField(game.ctx, field, game.time);
      game.ctx.restore();
    }
  }

  updateHUD();
  requestAnimationFrame(gameLoop);
}

// ─── Energy Drain ───────────────────────────────────────────────────────────

function updateEnergyDrain(dt) {
  if (!playerModel.alive) return;

  // Base drain rate
  let drain = playerModel.energyDrainRate * (dt / 1000);

  // Moving faster = more drain
  const isMoving = game.keys["w"] || game.keys["s"] || game.keys["a"] || game.keys["d"]
    || game.keys["arrowup"] || game.keys["arrowdown"] || game.keys["arrowleft"] || game.keys["arrowright"];
  if (isMoving) {
    drain *= 1 + (playerModel.moveSpeed - 3) * 0.3; // speed above base costs more
  }

  drainEnergy(playerModel, drain);
}

// ─── Energy Collection ──────────────────────────────────────────────────────

function checkEnergyCollection() {
  for (const node of game.energyNodes) {
    if (node.collected) continue;
    const dist = Math.sqrt((game.player.x - node.x) ** 2 + (game.player.y - node.y) ** 2);
    if (dist < 16) {
      node.collected = true;
      node.collectTime = Date.now();
      const gained = collectEnergy(playerModel, node.value);
      if (gained > 0) {
        addLogEntry(`+${gained.toFixed(0)} energy`, "system");
      }
    }
  }
}

// ─── Zone Transitions ───────────────────────────────────────────────────────

function checkZoneTransitions() {
  const currentZone = game.currentZone;
  if (currentZone !== lastZone) {
    const prevZone = lastZone;
    lastZone = currentZone;
    playerModel.zonesVisited.add(currentZone);
    explorationTracker.zonesVisited.add(currentZone);

    const zone = game.zones.find(z => z.id === currentZone);
    const mood = zone ? zone.mood : "unknown";

    send("zone_entered", {
      from_zone: prevZone,
      to_zone: currentZone,
      zone_mood: mood,
      zones_visited_count: playerModel.zonesVisited.size,
      emotion: "exploring",
    }, serializeState(playerModel, game, {
      choiceDescription: `Moved from "${prevZone}" into "${currentZone}" (mood: ${mood}).`,
    }));

    recordDecision(playerModel, {
      type: "zone_transition",
      description: `Entered ${currentZone} from ${prevZone}`,
    });

    addLogEntry(`Entered: ${currentZone}`, "system");
  }
}

// ─── Entity Proximity ───────────────────────────────────────────────────────

function checkEntityProximity() {
  const now = Date.now();
  if (now - lastProximityEvent < PROXIMITY_COOLDOWN) return;

  for (const entity of game.entities) {
    const dist = Math.sqrt((game.player.x - entity.x) ** 2 + (game.player.y - entity.y) ** 2);
    if (dist < 40) {
      lastProximityEvent = now;
      playerModel.entitiesEncountered++;

      send("entity_interaction", {
        entityType: entity.type,
        entityLore: entity.loreTag,
        entityBehavior: entity.behavior,
        emotion: "curiosity",
      }, serializeState(playerModel, game, {
        choiceDescription: `Approached "${entity.type}" (${entity.loreTag}).`,
      }));

      recordDecision(playerModel, {
        type: "entity_approach",
        description: `Approached ${entity.type}`,
      });

      addLogEntry(`You draw close to the ${entity.type}...`, "system");
      entity.alpha = 1.5;
      entity.scale = 1.4;
      break;
    }
  }
}

// ─── Mission Proximity ──────────────────────────────────────────────────────

function checkMissionProximity() {
  const now = Date.now();
  if (now - lastMissionCheck < MISSION_CHECK_INTERVAL) return;
  lastMissionCheck = now;

  for (let i = game.missions.length - 1; i >= 0; i--) {
    const mission = game.missions[i];
    if (!mission.active) continue;

    let triggered = false;

    if (mission.triggerCondition === "approach_entity") {
      for (const entity of game.entities) {
        const dist = Math.sqrt((game.player.x - entity.x) ** 2 + (game.player.y - entity.y) ** 2);
        if (dist < 50) { triggered = true; break; }
      }
    } else if (mission.triggerCondition === "reach_zone") {
      if (game.currentZone !== "wilderness") triggered = true;
    } else if (mission.triggerCondition === "explore") {
      if (explorationTracker.zonesVisited.size >= 3) triggered = true;
    } else if (mission.triggerCondition === "survive") {
      if (now - mission.injectedAt > 15000) triggered = true;
    } else if (mission.triggerCondition === "manual") {
      if (now - mission.injectedAt > 20000) triggered = true;
    } else if (mission.triggerCondition === "collect_energy") {
      if (playerModel.totalEnergyCollected > 50) triggered = true;
    }

    if (triggered) {
      mission.active = false;

      send("mission_complete", {
        title: mission.title,
        objective: mission.objective,
        originEvent: mission.originEvent,
        timeToComplete: (now - mission.injectedAt) / 1000,
        emotion: "accomplishment",
      }, serializeState(playerModel, game, {
        choiceDescription: `Completed mission "${mission.title}".`,
      }));

      recordDecision(playerModel, {
        type: "mission_complete",
        description: `Completed "${mission.title}"`,
      });

      addLogEntry(`Mission complete: ${mission.title}`, "narration");
      showNarration(`"${mission.title}" — complete`, 3000);

      const content = document.getElementById("active-mission-content");
      if (content) content.innerHTML = "<em>Awaiting next signal...</em>";
      break;
    }
  }
}

// ─── Ambient Pulse ──────────────────────────────────────────────────────────

function checkAmbientPulse() {
  const now = Date.now();
  if (now - lastAmbientPulse < AMBIENT_PULSE_INTERVAL) return;
  lastAmbientPulse = now;

  if (explorationTracker.distanceTraveled < 50) return;

  send("decision_made", {
    type: "ambient_exploration",
    description: `Explored ${explorationTracker.zonesVisited.size} zones`,
    zones_explored: explorationTracker.zonesVisited.size,
    entities_encountered: playerModel.entitiesEncountered,
    energy_level: Math.round(playerModel.energy),
    emotion: playerModel.energy < 30 ? "desperate" : "wandering",
  }, serializeState(playerModel, game, {
    choiceDescription: `Ambient pulse. Energy: ${Math.round(playerModel.energy)}. ${game.entities.length} entities present.`,
  }));

  explorationTracker.distanceTraveled = 0;
}

// ─── Exploration Tracker ────────────────────────────────────────────────────

function trackExploration() {
  const pos = { x: game.player.x, y: game.player.y };
  if (explorationTracker.lastPos) {
    const dx = pos.x - explorationTracker.lastPos.x;
    const dy = pos.y - explorationTracker.lastPos.y;
    explorationTracker.distanceTraveled += Math.sqrt(dx * dx + dy * dy);
  }
  explorationTracker.lastPos = { ...pos };
}

// ─── Game Over ──────────────────────────────────────────────────────────────

function triggerGameOver() {
  playerModel.alive = false;
  game.gameOver = true;

  if (gameOverShown) return;
  gameOverShown = true;

  const summary = getSessionSummary(playerModel);

  const summaryEl = document.getElementById("game-over-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="summary-line"><span class="summary-label">SURVIVED</span> ${summary.survivalTime}</div>
      <div class="summary-line"><span class="summary-label">ENERGY COLLECTED</span> ${summary.energyCollected}</div>
      <div class="summary-line"><span class="summary-label">DISTANCE</span> ${summary.distanceTraveled} units</div>
      <div class="summary-line"><span class="summary-label">ZONES EXPLORED</span> ${summary.zonesExplored}</div>
      <div class="summary-line"><span class="summary-label">ENTITIES MET</span> ${summary.entitiesEncountered}</div>
      <div class="summary-line"><span class="summary-label">MISSIONS</span> ${summary.missionsCompleted}</div>
      <div class="summary-line"><span class="summary-label">UPGRADES</span> ${summary.upgrades}</div>
      <div class="summary-line"><span class="summary-label">DECISIONS</span> ${summary.decisions}</div>
    `;
  }

  // Show game over screen
  setTimeout(() => {
    document.getElementById("game-over")?.classList.remove("hidden");
  }, 800);

  addLogEntry("Your energy is spent. The void reclaims.", "narration");
}

// ─── UI Functions ───────────────────────────────────────────────────────────

export function addLogEntry(text, type = "system", tone = "") {
  const log = document.getElementById("narrative-log");
  if (!log) return;

  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;

  if (tone) {
    const toneEl = document.createElement("div");
    toneEl.className = "log-tone";
    toneEl.textContent = tone;
    entry.appendChild(toneEl);
  }

  const textNode = document.createElement("span");
  textNode.textContent = text;
  entry.appendChild(textNode);

  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;

  while (log.children.length > 60) log.removeChild(log.firstChild);
}

export function showNarration(message, duration = 3000) {
  const overlay = document.getElementById("narration-overlay");
  if (!overlay) return;
  overlay.textContent = message;
  overlay.classList.remove("hidden");
  if (overlay._timeout) clearTimeout(overlay._timeout);
  overlay._timeout = setTimeout(() => overlay.classList.add("hidden"), duration);
}

function updateHUD() {
  // Energy bar
  const fill = document.getElementById("energy-bar-fill");
  const text = document.getElementById("energy-text");
  if (fill) {
    const pct = Math.max(0, (playerModel.energy / playerModel.maxEnergy) * 100);
    fill.style.width = `${pct}%`;
    fill.classList.toggle("low", pct < 25);
  }
  if (text) text.textContent = Math.round(playerModel.energy);

  // Stats
  const sight = document.getElementById("stat-sight");
  const speed = document.getElementById("stat-speed");
  const memory = document.getElementById("stat-memory");
  if (sight) sight.textContent = playerModel.sightRadius;
  if (speed) speed.textContent = playerModel.moveSpeed.toFixed(1);
  if (memory) memory.textContent = `${(playerModel.mapMemory * 100).toFixed(0)}%`;

  // Zone
  const zoneName = document.getElementById("zone-name");
  if (zoneName) zoneName.textContent = game.currentZone;
}

function updateStatus(status) {
  playerModel.status = status;
  const el = document.getElementById("status-text");
  if (el) el.textContent = status;
}

function updateDepth(depth) {
  const el = document.getElementById("depth-value");
  if (el) el.textContent = depth;
}

// ─── Boot ───────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
