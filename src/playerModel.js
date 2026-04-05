/**
 * ENDLESS — Player Model
 * Survival RPG stats: energy, sight, speed, map memory.
 */

export function createPlayerModel() {
  return {
    // Position
    position: { x: 0, y: 0 },

    // Core stats
    energy: 100,
    maxEnergy: 100,
    energyDrainRate: 0.8, // per second at base speed
    sightRadius: 120,
    moveSpeed: 3,
    mapMemory: 0, // 0-1, fraction of explored map that persists

    // State
    currentZone: "unknown",
    status: "initializing",
    alive: true,

    // Tracking
    decisions: [],
    failures: [],
    emotionTags: [],
    activeMission: null,
    missionLog: [],
    sessionDepth: 0,
    totalEnergyCollected: 0,
    totalDistanceTraveled: 0,
    entitiesEncountered: 0,
    zonesVisited: new Set(),
    startTime: Date.now(),

    // Hesitation timers
    hesitationTimers: {},

    // Upgrades collected
    upgrades: [],
  };
}

export function recordDecision(model, decision) {
  model.decisions.push({ ...decision, timestamp: Date.now() });
}

export function recordFailure(model, failure) {
  model.failures.push({ ...failure, timestamp: Date.now() });
}

export function addEmotionTag(model, tag) {
  model.emotionTags.push(tag);
}

export function setActiveMission(model, mission) {
  model.activeMission = mission;
}

export function completeMission(model) {
  if (model.activeMission) {
    model.missionLog.push({ ...model.activeMission, completedAt: Date.now() });
    model.activeMission = null;
    model.sessionDepth++;
  }
}

export function drainEnergy(model, amount) {
  model.energy = Math.max(0, model.energy - amount);
  return model.energy > 0;
}

export function collectEnergy(model, amount) {
  const before = model.energy;
  model.energy = Math.min(model.maxEnergy, model.energy + amount);
  const gained = model.energy - before;
  model.totalEnergyCollected += gained;
  return gained;
}

export function applySightUpgrade(model, amount) {
  model.sightRadius += amount;
  model.upgrades.push({ type: "sight", amount, time: Date.now() });
}

export function applySpeedUpgrade(model, amount) {
  model.moveSpeed += amount;
  model.upgrades.push({ type: "speed", amount, time: Date.now() });
}

export function applyMemoryUpgrade(model, amount) {
  model.mapMemory = Math.min(1, model.mapMemory + amount);
  model.upgrades.push({ type: "memory", amount, time: Date.now() });
}

export function startHesitation(model, key) {
  model.hesitationTimers[key] = Date.now();
}

export function endHesitation(model, key) {
  const start = model.hesitationTimers[key];
  if (start) {
    const duration = (Date.now() - start) / 1000;
    delete model.hesitationTimers[key];
    return duration;
  }
  return 0;
}

export function getSessionSummary(model) {
  const duration = ((Date.now() - model.startTime) / 1000).toFixed(0);
  return {
    survivalTime: `${Math.floor(duration / 60)}m ${duration % 60}s`,
    energyCollected: model.totalEnergyCollected.toFixed(0),
    distanceTraveled: model.totalDistanceTraveled.toFixed(0),
    zonesExplored: model.zonesVisited.size,
    entitiesEncountered: model.entitiesEncountered,
    missionsCompleted: model.missionLog.length,
    upgrades: model.upgrades.length,
    decisions: model.decisions.length,
  };
}
