/**
 * ENDLESS — Event Serializer
 * Converts game state to plain-English text snapshots.
 */

export function serializeState(playerModel, gameState, eventContext = {}) {
  const parts = [];

  const zone = gameState.currentZone || playerModel.currentZone || "unknown";
  parts.push(`Current zone: ${zone}.`);
  parts.push(`Energy: ${Math.round(playerModel.energy)}/${playerModel.maxEnergy}.`);
  parts.push(`Sight: ${playerModel.sightRadius}. Speed: ${playerModel.moveSpeed.toFixed(1)}. Memory: ${(playerModel.mapMemory * 100).toFixed(0)}%.`);

  if (playerModel.activeMission) {
    parts.push(`Active mission: ${playerModel.activeMission.title}.`);
  }

  parts.push(`Zones explored: ${playerModel.zonesVisited.size}. Entities encountered: ${playerModel.entitiesEncountered}.`);
  parts.push(`Session depth: ${playerModel.sessionDepth}. Distance traveled: ${playerModel.totalDistanceTraveled.toFixed(0)}.`);

  if (eventContext.hesitationTime) parts.push(`Hesitated ${eventContext.hesitationTime.toFixed(1)}s before deciding.`);
  if (eventContext.choiceDescription) parts.push(eventContext.choiceDescription);

  if (playerModel.decisions.length > 0) {
    const recent = playerModel.decisions.slice(-3);
    parts.push(`Recent: ${recent.map(d => d.description || d.type).join("; ")}.`);
  }

  return parts.join(" ");
}

export function serializeCalibrationSummary(results) {
  const parts = ["=== CALIBRATION SUMMARY ==="];

  if (results.the_fork) {
    const f = results.the_fork;
    parts.push(`The Fork: Chose "${f.choice}" after ${f.hesitationTime.toFixed(1)}s. First looked at ${f.firstLook}. Risk appetite: ${f.riskAppetite}.`);
  }

  if (results.the_drain) {
    const d = results.the_drain;
    parts.push(`The Drain: ${d.reachedCenter ? "Crossed drain field to collect reward" : d.enteredField ? "Entered field but turned back" : "Stayed outside the field"}. Edge hover: ${d.edgeHoverTime.toFixed(1)}s. Loss tolerance: ${d.lossTolerance}.`);
  }

  if (results.the_hoard) {
    const h = results.the_hoard;
    parts.push(`The Hoard: Took ${h.orbsChosen.map(o => o.upgrade.type).join("+")}. Left: ${h.orbLeft?.upgrade.type || "unknown"}. Strategy: ${h.strategy}. Decision time: ${h.hesitationTime.toFixed(1)}s.`);
  }

  if (results.the_presence) {
    const p = results.the_presence;
    parts.push(`The Presence: ${p.confrontationInstinct} response. Behavior: ${p.behavior}. Response time: ${p.responseTime.toFixed(1)}s.`);
  }

  return parts.join(" ");
}
