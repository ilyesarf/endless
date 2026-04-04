/**
 * ENDLESS — Main Entry Point
 * Initializes game loop, WebSocket, calibration missions.
 */

import { createGame, updateGame, renderGame } from "./game.js";
import { createPlayerModel } from "./playerModel.js";
import { connect, send, isConnected } from "./socket.js";
import { executeCommands, initExecutor } from "./executor.js";
import {
  initMissions,
  startCalibration,
  checkCalibrationCollisions,
  isCalibrationComplete,
  getCurrentPhase,
} from "./missions.js";
import { serializeState } from "./serializer.js";

// ─── State ──────────────────────────────────────────────────────────────────

let game = null;
let playerModel = null;
let lastFrame = 0;
let started = false;
let sessionId = null;

// ─── Expose helpers globally for circular dep resolution ────────────────────

window.__endless_addLogEntry = addLogEntry;
window.__endless_showNarration = showNarration;

// ─── Init ───────────────────────────────────────────────────────────────────

function init() {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) {
    console.error("Canvas not found");
    return;
  }

  // Create game and player model
  game = createGame(canvas);
  playerModel = createPlayerModel();

  // Init subsystems
  initExecutor(game);
  initMissions(playerModel, game);

  // Connect WebSocket
  connect(onServerMessage);

  // Update status
  updateBottomBar();
  addLogEntry("Establishing connection to the void...", "system");

  // Start game loop
  requestAnimationFrame(gameLoop);
}

// ─── Server Messages ────────────────────────────────────────────────────────

function onServerMessage(data) {
  switch (data.type) {
    case "session_init":
      sessionId = data.session_id;
      addLogEntry("Connection established.", "system");
      addLogEntry(data.message || "The void awaits.", "narration");
      updateStatus("calibrating");

      // Start calibration after a brief delay
      setTimeout(() => {
        if (!started) {
          started = true;
          startCalibration();
          addLogEntry("Calibration sequence initiated.", "system");
        }
      }, 2000);
      break;

    case "commands":
      if (data.commands && Array.isArray(data.commands)) {
        executeCommands(data.commands);
        playerModel.sessionDepth++;
        updateDepth(playerModel.sessionDepth);
      }
      break;

    case "ack":
      // Acknowledged, no action needed
      break;

    default:
      console.log("[MAIN] Unknown message type:", data.type);
  }
}

// ─── Game Loop ──────────────────────────────────────────────────────────────

function gameLoop(timestamp) {
  const dt = timestamp - lastFrame;
  lastFrame = timestamp;

  // Update
  updateGame(game, playerModel, dt);

  // Check calibration collisions
  if (!isCalibrationComplete()) {
    checkCalibrationCollisions(game.player.x, game.player.y);
  }

  // Handle entity proximity events (post-calibration)
  if (isCalibrationComplete()) {
    checkEntityProximity();
  }

  // Render
  renderGame(game);

  // Update UI
  updateBottomBar();

  requestAnimationFrame(gameLoop);
}

// ─── Entity Proximity ───────────────────────────────────────────────────────

let lastProximityEvent = 0;
const PROXIMITY_COOLDOWN = 10000; // 10s between proximity events

function checkEntityProximity() {
  const now = Date.now();
  if (now - lastProximityEvent < PROXIMITY_COOLDOWN) return;

  for (const entity of game.entities) {
    const dx = game.player.x - entity.x;
    const dy = game.player.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 40) {
      lastProximityEvent = now;
      const snapshot = serializeState(playerModel, game, {
        choiceDescription: `Player approached entity "${entity.type}" (${entity.loreTag}).`,
      });

      send("entity_interaction", {
        entityType: entity.type,
        entityLore: entity.loreTag,
        entityBehavior: entity.behavior,
      }, snapshot);

      addLogEntry(`You draw close to the ${entity.type}...`, "system");
      break;
    }
  }
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

  // Limit log entries
  while (log.children.length > 50) {
    log.removeChild(log.firstChild);
  }
}

export function showNarration(message, duration = 3000) {
  const overlay = document.getElementById("narration-overlay");
  if (!overlay) return;

  overlay.textContent = message;
  overlay.classList.remove("hidden");

  // Clear any existing timeout
  if (overlay._timeout) clearTimeout(overlay._timeout);

  overlay._timeout = setTimeout(() => {
    overlay.classList.add("hidden");
  }, duration);
}

function updateBottomBar() {
  // Zone
  const zoneName = document.getElementById("zone-name");
  if (zoneName) zoneName.textContent = game.currentZone;

  // Resources
  const bar = document.getElementById("resource-bar");
  const text = document.getElementById("resource-text");
  if (bar) {
    const pct = (playerModel.resources.current / playerModel.resources.max) * 100;
    bar.style.setProperty("--energy-pct", `${pct}%`);
  }
  if (text) {
    text.textContent = `${playerModel.resources.current}/${playerModel.resources.max}`;
  }
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
