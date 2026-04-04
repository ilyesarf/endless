/**
 * ENDLESS — Event Serializer
 * Converts game state to plain-English text snapshots.
 */

export function serializeState(playerModel, gameState, eventContext = {}) {
  const parts = [];

  // Current position context
  const zone = gameState.currentZone || playerModel.currentZone || "void";
  parts.push(`Current zone: ${zone}.`);

  // Resources
  parts.push(
    `Resources: ${playerModel.resources.current}/${playerModel.resources.max}.`
  );

  // Active mission
  if (playerModel.activeMission) {
    parts.push(`Active mission: ${playerModel.activeMission.title}.`);
  }

  // Event-specific context
  if (eventContext.hesitationTime) {
    parts.push(
      `Player hesitated ${eventContext.hesitationTime.toFixed(1)}s before deciding.`
    );
  }

  if (eventContext.choiceDescription) {
    parts.push(eventContext.choiceDescription);
  }

  if (eventContext.approachTime) {
    parts.push(
      `Player took ${eventContext.approachTime.toFixed(1)}s to approach.`
    );
  }

  if (eventContext.resourcesSpent !== undefined) {
    parts.push(`Player spent ${eventContext.resourcesSpent} resources.`);
  }

  if (eventContext.abandoned) {
    parts.push("Player chose to leave through the exit.");
  }

  if (eventContext.pushedThrough) {
    parts.push("Player pushed through despite the option to leave.");
  }

  if (eventContext.engaged) {
    parts.push("Player chose to engage directly.");
  }

  if (eventContext.avoided) {
    parts.push("Player found a way around instead of engaging.");
  }

  // Session depth
  parts.push(`Session depth: ${playerModel.sessionDepth}.`);

  // Recent decisions (last 3)
  if (playerModel.decisions.length > 0) {
    const recent = playerModel.decisions.slice(-3);
    const decisionSummary = recent
      .map((d) => d.description || d.type || "unknown")
      .join("; ");
    parts.push(`Recent decisions: ${decisionSummary}.`);
  }

  return parts.join(" ");
}

export function serializeCalibrationSummary(calibrationResults) {
  const parts = ["=== CALIBRATION SUMMARY ==="];

  if (calibrationResults.the_fork) {
    const f = calibrationResults.the_fork;
    parts.push(
      `The Fork: Player chose "${f.choice}" after hesitating ${f.hesitationTime.toFixed(1)}s.`
    );
  }

  if (calibrationResults.the_abandon) {
    const a = calibrationResults.the_abandon;
    parts.push(
      `The Abandon: Player ${a.abandoned ? "left through the exit" : "pushed through"} after ${a.timeSpent.toFixed(1)}s.`
    );
  }

  if (calibrationResults.the_scarcity) {
    const s = calibrationResults.the_scarcity;
    parts.push(
      `The Scarcity: Player spent ${s.resourcesSpent}/${s.resourcesAvailable} resources. Strategy: ${s.strategy}.`
    );
  }

  if (calibrationResults.the_confrontation) {
    const c = calibrationResults.the_confrontation;
    parts.push(
      `The Confrontation: Player ${c.engaged ? "engaged directly" : "avoided"} after ${c.approachTime.toFixed(1)}s.`
    );
  }

  return parts.join(" ");
}
