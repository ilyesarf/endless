/**
 * ENDLESS — Command Executor
 * Receives JSON command arrays from server, dispatches to game systems.
 */

import { addLogEntry, showNarration } from "./main.js";

let gameRef = null;

export function initExecutor(game) {
  gameRef = game;
}

export function executeCommands(commands) {
  if (!Array.isArray(commands)) {
    console.warn("[EXEC] Expected array, got:", typeof commands);
    return;
  }

  for (const cmd of commands) {
    try {
      switch (cmd.cmd) {
        case "spawn_entity":
          handleSpawnEntity(cmd);
          break;
        case "mutate_zone":
          handleMutateZone(cmd);
          break;
        case "inject_mission":
          handleInjectMission(cmd);
          break;
        case "narrate":
          handleNarrate(cmd);
          break;
        default:
          console.warn("[EXEC] Unknown command:", cmd.cmd);
      }
    } catch (err) {
      console.error("[EXEC] Error executing command:", cmd, err);
    }
  }
}

function handleSpawnEntity(cmd) {
  if (!gameRef) return;

  const entity = {
    id: `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: cmd.type || "unknown",
    x: cmd.position?.x ?? Math.random() * gameRef.canvas.width,
    y: cmd.position?.y ?? Math.random() * gameRef.canvas.height,
    behavior: cmd.behavior || "idle",
    loreTag: cmd.lore_tag || "",
    spawnTime: Date.now(),
    alpha: 0,
    phase: 0,
    scale: 1,
  };

  gameRef.entities.push(entity);
  addLogEntry(`Entity manifested: ${entity.type}`, "system");
  if (entity.loreTag) {
    addLogEntry(`  "${entity.loreTag}"`, "narration");
  }
  console.log("[EXEC] Spawned entity:", entity.type, "at", entity.x, entity.y);
}

function handleMutateZone(cmd) {
  if (!gameRef) return;

  const zone = gameRef.zones.find((z) => z.id === cmd.zone_id);
  if (zone) {
    // Smooth transition targets
    zone.targetMood = cmd.mood || zone.mood;
    zone.targetColor = cmd.color || zone.color;
    zone.ambientText = cmd.ambient_text || zone.ambientText;
    zone.transitioning = true;
    zone.transitionStart = Date.now();
  } else {
    // Create new zone if not found
    gameRef.zones.push({
      id: cmd.zone_id || `zone_${gameRef.zones.length}`,
      x: 100 + Math.random() * (gameRef.canvas.width - 200),
      y: 100 + Math.random() * (gameRef.canvas.height - 200),
      radius: 120 + Math.random() * 80,
      color: cmd.color || "#1a1a2e",
      targetColor: cmd.color || "#1a1a2e",
      mood: cmd.mood || "neutral",
      targetMood: cmd.mood || "neutral",
      ambientText: cmd.ambient_text || "",
      alpha: 0,
      transitioning: true,
      transitionStart: Date.now(),
    });
  }

  addLogEntry(`Zone shift: ${cmd.mood || "unknown"} mood`, "system");
  if (cmd.ambient_text) {
    addLogEntry(`  "${cmd.ambient_text}"`, "narration");
  }

  // Update zone name in bottom bar
  const zoneNameEl = document.getElementById("zone-name");
  if (zoneNameEl && cmd.zone_id) {
    zoneNameEl.textContent = cmd.zone_id;
  }
}

function handleInjectMission(cmd) {
  if (!gameRef) return;

  const mission = {
    title: cmd.title || "Unknown Mission",
    objective: cmd.objective || "",
    triggerCondition: cmd.trigger_condition || "manual",
    originEvent: cmd.origin_event || "",
    injectedAt: Date.now(),
    active: true,
  };

  gameRef.missions.push(mission);

  // Show mission prompt on canvas
  const promptEl = document.getElementById("mission-prompt");
  const titleEl = document.getElementById("mission-prompt-title");
  const objEl = document.getElementById("mission-prompt-objective");

  if (promptEl && titleEl && objEl) {
    titleEl.textContent = mission.title;
    objEl.textContent = mission.objective;
    promptEl.classList.remove("hidden");
    setTimeout(() => promptEl.classList.add("hidden"), 6000);
  }

  // Update active mission panel
  const missionContent = document.getElementById("active-mission-content");
  if (missionContent) {
    missionContent.innerHTML = `<strong>${mission.title}</strong><br/>${mission.objective}`;
  }

  addLogEntry(`New mission: ${mission.title}`, "narration");
  addLogEntry(`  → ${mission.objective}`, "system");
}

function handleNarrate(cmd) {
  const message = cmd.message || "";
  const tone = cmd.tone || "neutral";
  const duration = cmd.duration_ms || 3000;

  showNarration(message, duration);
  addLogEntry(message, "narration", tone);
}
