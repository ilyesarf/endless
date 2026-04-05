/**
 * ENDLESS — Command Executor
 * Receives JSON command arrays from server, dispatches to game systems.
 */

import { spawnEnergyNode } from "./game.js";

let gameRef = null;

export function initExecutor(game) {
  gameRef = game;
}

export function executeCommands(commands) {
  if (!Array.isArray(commands)) return;

  for (const cmd of commands) {
    try {
      switch (cmd.cmd) {
        case "spawn_entity": handleSpawnEntity(cmd); break;
        case "mutate_zone": handleMutateZone(cmd); break;
        case "inject_mission": handleInjectMission(cmd); break;
        case "narrate": handleNarrate(cmd); break;
        default: console.warn("[EXEC] Unknown command:", cmd.cmd);
      }
    } catch (err) {
      console.error("[EXEC] Error:", cmd, err);
    }
  }
}

function handleSpawnEntity(cmd) {
  if (!gameRef) return;

  const entity = {
    id: `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: cmd.type || "unknown",
    x: cmd.position?.x ?? gameRef.player.x + (Math.random() - 0.5) * 400,
    y: cmd.position?.y ?? gameRef.player.y + (Math.random() - 0.5) * 300,
    behavior: cmd.behavior || "idle",
    loreTag: cmd.lore_tag || "",
    spawnTime: Date.now(),
    alpha: 0,
    phase: 0,
    scale: 1,
  };

  gameRef.entities.push(entity);
  logEntry(`Entity manifested: ${entity.type}`, "system");
  if (entity.loreTag) logEntry(`  "${entity.loreTag}"`, "narration");
}

function handleMutateZone(cmd) {
  if (!gameRef) return;

  const zone = gameRef.zones.find(z => z.id === cmd.zone_id);
  if (zone) {
    zone.targetMood = cmd.mood || zone.mood;
    zone.targetColor = cmd.color || zone.color;
    zone.ambientText = cmd.ambient_text || zone.ambientText;
    zone.transitioning = true;
    zone.transitionStart = Date.now();
  } else {
    // Spawn new zone near player
    const angle = Math.random() * Math.PI * 2;
    const dist = 250 + Math.random() * 300;
    gameRef.zones.push({
      id: cmd.zone_id || `zone_${gameRef.zones.length}`,
      x: gameRef.player.x + Math.cos(angle) * dist,
      y: gameRef.player.y + Math.sin(angle) * dist,
      radius: 140 + Math.random() * 100,
      color: cmd.color || "#1a1a2a",
      targetColor: cmd.color || "#1a1a2a",
      mood: cmd.mood || "neutral",
      targetMood: cmd.mood || "neutral",
      ambientText: cmd.ambient_text || "",
      label: cmd.zone_id || "",
      alpha: 0,
      transitioning: true,
      transitionStart: Date.now(),
    });

    // Spawn some energy nodes in the new zone
    const zx = gameRef.zones[gameRef.zones.length - 1].x;
    const zy = gameRef.zones[gameRef.zones.length - 1].y;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
      const na = Math.random() * Math.PI * 2;
      const nd = Math.random() * 120;
      spawnEnergyNode(gameRef, zx + Math.cos(na) * nd, zy + Math.sin(na) * nd);
    }
  }

  logEntry(`Zone shift: ${cmd.mood || "unknown"} mood`, "system");
  if (cmd.ambient_text) logEntry(`  "${cmd.ambient_text}"`, "narration");

  const zoneNameEl = document.getElementById("zone-name");
  if (zoneNameEl && cmd.zone_id) zoneNameEl.textContent = cmd.zone_id;
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

  const promptEl = document.getElementById("mission-prompt");
  const titleEl = document.getElementById("mission-prompt-title");
  const objEl = document.getElementById("mission-prompt-objective");
  if (promptEl && titleEl && objEl) {
    titleEl.textContent = mission.title;
    objEl.textContent = mission.objective;
    promptEl.classList.remove("hidden");
    setTimeout(() => promptEl.classList.add("hidden"), 6000);
  }

  const missionContent = document.getElementById("active-mission-content");
  if (missionContent) {
    missionContent.innerHTML = `<strong>${mission.title}</strong><br/>${mission.objective}`;
  }

  logEntry(`New mission: ${mission.title}`, "narration");
  logEntry(`  → ${mission.objective}`, "system");
}

function handleNarrate(cmd) {
  window.__endless_showNarration?.(cmd.message || "", cmd.duration_ms || 3000);
  logEntry(cmd.message || "", "narration", cmd.tone || "");
}

function logEntry(text, type, tone) {
  window.__endless_addLogEntry?.(text, type, tone);
}
