/**
 * ENDLESS — Player Model (client-side mirror)
 * Tracks decisions, resources, active missions, current zone, calibration state.
 */

export function createPlayerModel() {
  return {
    position: { x: 400, y: 300 },
    speed: 3,
    resources: { current: 10, max: 10 },
    currentZone: "void",
    decisions: [],
    failures: [],
    emotionTags: [],
    activeMission: null,
    missionLog: [],
    sessionDepth: 0,
    lastDecisionTime: 0,
    hesitationTimers: {},
    status: "initializing",
  };
}

export function recordDecision(model, decision) {
  model.decisions.push({
    ...decision,
    timestamp: Date.now(),
  });
}

export function recordFailure(model, failure) {
  model.failures.push({
    ...failure,
    timestamp: Date.now(),
  });
}

export function addEmotionTag(model, tag) {
  model.emotionTags.push(tag);
}

export function setActiveMission(model, mission) {
  model.activeMission = mission;
}

export function completeMission(model) {
  if (model.activeMission) {
    model.missionLog.push({
      ...model.activeMission,
      completedAt: Date.now(),
    });
    model.activeMission = null;
    model.sessionDepth++;
  }
}

export function spendResource(model, amount = 1) {
  model.resources.current = Math.max(0, model.resources.current - amount);
}

export function gainResource(model, amount = 1) {
  model.resources.current = Math.min(
    model.resources.max,
    model.resources.current + amount
  );
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
