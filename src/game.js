/**
 * ENDLESS — Game Engine
 * Canvas 2D: fog of war, camera, zones, energy nodes, entities, player trail.
 */

// ─── World Constants ────────────────────────────────────────────────────────

const WORLD_W = 3000;
const WORLD_H = 2200;
const GRID_SIZE = 50;

// ─── Create Game ────────────────────────────────────────────────────────────

export function createGame(canvas) {
  const ctx = canvas.getContext("2d");

  const game = {
    canvas, ctx,

    // World size
    worldW: WORLD_W,
    worldH: WORLD_H,

    // Player
    player: {
      x: WORLD_W / 2,
      y: WORLD_H / 2,
      radius: 5,
      glowRadius: 14,
      trail: [],
    },

    // Camera
    camera: { x: 0, y: 0 },

    // World objects
    zones: [],
    entities: [],
    energyNodes: [],
    missions: [],
    calibrationObjects: [],

    // Fog of war — 2D grid of 0.0 (unexplored) to 1.0 (fully visible)
    fogGrid: null,
    fogCols: 0,
    fogRows: 0,

    // Input
    keys: {},

    // State
    currentZone: "unknown",
    time: 0,
    gameOver: false,
  };

  // Resize canvas to container
  function resize() {
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  // Init fog grid
  game.fogCols = Math.ceil(WORLD_W / GRID_SIZE);
  game.fogRows = Math.ceil(WORLD_H / GRID_SIZE);
  game.fogGrid = new Float32Array(game.fogCols * game.fogRows); // all 0 = full fog

  // Init zones with warm colors
  game.zones = [
    createZone("origin",    WORLD_W/2,      WORLD_H/2,      180, "#2a1f0a", "familiar",    "warm amber"),
    createZone("teal_well", WORLD_W/2 - 500, WORLD_H/2 - 300, 220, "#0a2a25", "curious",     "deep teal"),
    createZone("red_den",   WORLD_W/2 + 450, WORLD_H/2 + 250, 200, "#2a0a0a", "tense",       "ember red"),
    createZone("blue_deep", WORLD_W/2 - 300, WORLD_H/2 + 400, 240, "#0a1428", "contemplative","cool blue"),
    createZone("far_amber", WORLD_W/2 + 600, WORLD_H/2 - 400, 180, "#281a04", "distant",     "far amber"),
  ];

  // Scatter energy nodes
  for (let i = 0; i < 40; i++) {
    game.energyNodes.push(createEnergyNode(game));
  }

  // Input
  window.addEventListener("keydown", (e) => {
    game.keys[e.key.toLowerCase()] = true;
    if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    game.keys[e.key.toLowerCase()] = false;
  });

  return game;
}

function createZone(id, x, y, radius, color, mood, label) {
  return {
    id, x, y, radius, label,
    color, targetColor: color,
    mood, targetMood: mood,
    ambientText: "",
    alpha: 0.55,
    transitioning: false,
    transitionStart: 0,
  };
}

function createEnergyNode(game) {
  // Place near zones preferentially
  const zone = game.zones[Math.floor(Math.random() * game.zones.length)];
  const angle = Math.random() * Math.PI * 2;
  const dist = zone.radius * 0.3 + Math.random() * zone.radius * 1.2;
  return {
    id: `en_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
    x: Math.max(40, Math.min(WORLD_W - 40, zone.x + Math.cos(angle) * dist)),
    y: Math.max(40, Math.min(WORLD_H - 40, zone.y + Math.sin(angle) * dist)),
    value: 8 + Math.floor(Math.random() * 12),
    radius: 6,
    collected: false,
    phase: Math.random() * Math.PI * 2,
    pulseSpeed: 0.002 + Math.random() * 0.002,
  };
}

export function spawnEnergyNode(game, x, y, value) {
  game.energyNodes.push({
    id: `en_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
    x, y,
    value: value || 10 + Math.floor(Math.random() * 10),
    radius: 6,
    collected: false,
    phase: Math.random() * Math.PI * 2,
    pulseSpeed: 0.003,
  });
}

// ─── Update ─────────────────────────────────────────────────────────────────

export function updateGame(game, playerModel, dt) {
  if (game.gameOver) return;
  game.time += dt;

  // ─── Player Movement ─────────────────────────────────────────────
  const speed = playerModel.moveSpeed;
  let dx = 0, dy = 0;
  if (game.keys["w"] || game.keys["arrowup"])    dy -= speed;
  if (game.keys["s"] || game.keys["arrowdown"])  dy += speed;
  if (game.keys["a"] || game.keys["arrowleft"])  dx -= speed;
  if (game.keys["d"] || game.keys["arrowright"]) dx += speed;

  if (dx !== 0 && dy !== 0) {
    const n = 1 / Math.SQRT2;
    dx *= n; dy *= n;
  }

  const moving = dx !== 0 || dy !== 0;

  game.player.x = Math.max(8, Math.min(WORLD_W - 8, game.player.x + dx));
  game.player.y = Math.max(8, Math.min(WORLD_H - 8, game.player.y + dy));

  if (moving) {
    playerModel.totalDistanceTraveled += Math.sqrt(dx*dx + dy*dy);
  }

  // Trail
  if (moving) {
    game.player.trail.push({ x: game.player.x, y: game.player.y, alpha: 0.45 });
    if (game.player.trail.length > 50) game.player.trail.shift();
  }
  for (const t of game.player.trail) t.alpha *= 0.97;
  game.player.trail = game.player.trail.filter(t => t.alpha > 0.015);

  // ─── Camera ───────────────────────────────────────────────────────
  const targetCX = game.player.x - game.canvas.width / 2;
  const targetCY = game.player.y - game.canvas.height / 2;
  game.camera.x += (targetCX - game.camera.x) * 0.08;
  game.camera.y += (targetCY - game.camera.y) * 0.08;
  game.camera.x = Math.max(0, Math.min(WORLD_W - game.canvas.width, game.camera.x));
  game.camera.y = Math.max(0, Math.min(WORLD_H - game.canvas.height, game.camera.y));

  // ─── Fog of War ──────────────────────────────────────────────────
  const sightR = playerModel.sightRadius;
  const fogCellsRadius = Math.ceil(sightR / GRID_SIZE) + 1;
  const pcol = Math.floor(game.player.x / GRID_SIZE);
  const prow = Math.floor(game.player.y / GRID_SIZE);

  for (let r = prow - fogCellsRadius; r <= prow + fogCellsRadius; r++) {
    for (let c = pcol - fogCellsRadius; c <= pcol + fogCellsRadius; c++) {
      if (r < 0 || r >= game.fogRows || c < 0 || c >= game.fogCols) continue;
      const cx = (c + 0.5) * GRID_SIZE;
      const cy = (r + 0.5) * GRID_SIZE;
      const dist = Math.sqrt((game.player.x - cx) ** 2 + (game.player.y - cy) ** 2);
      if (dist < sightR) {
        const visibility = 1 - (dist / sightR);
        const idx = r * game.fogCols + c;
        game.fogGrid[idx] = Math.max(game.fogGrid[idx], visibility);
      }
    }
  }

  // Fog decay (map memory) — explored cells slowly return to fog
  const memoryRetention = playerModel.mapMemory;
  for (let i = 0; i < game.fogGrid.length; i++) {
    const cx = ((i % game.fogCols) + 0.5) * GRID_SIZE;
    const cy = (Math.floor(i / game.fogCols) + 0.5) * GRID_SIZE;
    const distToPlayer = Math.sqrt((game.player.x - cx) ** 2 + (game.player.y - cy) ** 2);
    if (distToPlayer > sightR) {
      // Decay toward memory floor
      const floor = memoryRetention * game.fogGrid[i];
      const decayRate = 0.0003;
      if (game.fogGrid[i] > floor) {
        game.fogGrid[i] = Math.max(floor, game.fogGrid[i] - decayRate);
      }
    }
  }

  // ─── Energy Node Collection ───────────────────────────────────────
  for (const node of game.energyNodes) {
    if (node.collected) continue;
    node.phase += node.pulseSpeed * dt;
    const dist = Math.sqrt((game.player.x - node.x)**2 + (game.player.y - node.y)**2);
    if (dist < 16) {
      node.collected = true;
    }
  }
  // Clean collected nodes
  game.energyNodes = game.energyNodes.filter(n => !n.collected || (Date.now() - (n.collectTime||0)) < 500);

  // ─── Entity Updates ───────────────────────────────────────────────
  for (const entity of game.entities) {
    entity.phase += 0.02;
    entity.alpha = Math.min(1, entity.alpha + 0.008);

    switch (entity.behavior) {
      case "orbit":
        entity.x += Math.cos(entity.phase) * 0.5;
        entity.y += Math.sin(entity.phase) * 0.5;
        break;
      case "drift":
        entity.x += Math.sin(entity.phase * 0.5) * 0.3;
        entity.y -= 0.08;
        break;
      case "pulse":
        entity.scale = 1 + Math.sin(entity.phase * 2) * 0.2;
        break;
      case "follow":
        const fdx = game.player.x - entity.x;
        const fdy = game.player.y - entity.y;
        const fdist = Math.sqrt(fdx*fdx + fdy*fdy);
        if (fdist > 60) {
          entity.x += (fdx / fdist) * 0.4;
          entity.y += (fdy / fdist) * 0.4;
        }
        break;
      case "block":
        // stationary, pulses menacingly
        entity.scale = 1 + Math.sin(entity.phase * 1.5) * 0.12;
        break;
    }
  }

  // ─── Zone Transitions ─────────────────────────────────────────────
  for (const zone of game.zones) {
    if (zone.transitioning) {
      zone.alpha = Math.min(0.7, zone.alpha + 0.003);
      const elapsed = Date.now() - zone.transitionStart;
      if (elapsed > 2500) {
        zone.color = zone.targetColor;
        zone.mood = zone.targetMood;
        zone.transitioning = false;
      } else {
        zone.color = lerpColor(zone.color, zone.targetColor, 0.015);
      }
    }
  }

  // ─── Zone Detection ───────────────────────────────────────────────
  let inZone = "wilderness";
  for (const zone of game.zones) {
    const zd = Math.sqrt((game.player.x - zone.x)**2 + (game.player.y - zone.y)**2);
    if (zd < zone.radius) {
      inZone = zone.id;
    }
  }
  game.currentZone = inZone;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderGame(game, playerModel) {
  const { ctx, canvas, camera } = game;

  // Clear
  ctx.fillStyle = "#050508";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // ─── Subtle grid ──────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(40, 36, 28, 0.12)";
  ctx.lineWidth = 0.5;
  const startC = Math.floor(camera.x / GRID_SIZE) * GRID_SIZE;
  const startR = Math.floor(camera.y / GRID_SIZE) * GRID_SIZE;
  for (let x = startC; x < camera.x + canvas.width + GRID_SIZE; x += GRID_SIZE) {
    ctx.beginPath(); ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y + canvas.height); ctx.stroke();
  }
  for (let y = startR; y < camera.y + canvas.height + GRID_SIZE; y += GRID_SIZE) {
    ctx.beginPath(); ctx.moveTo(camera.x, y); ctx.lineTo(camera.x + canvas.width, y); ctx.stroke();
  }

  // ─── Zones ────────────────────────────────────────────────────────
  for (const zone of game.zones) {
    if (!isOnScreen(zone.x, zone.y, zone.radius + 50, camera, canvas)) continue;
    const grad = ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
    grad.addColorStop(0, hexToRgba(zone.color, zone.alpha * 0.7));
    grad.addColorStop(0.5, hexToRgba(zone.color, zone.alpha * 0.35));
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    ctx.fill();

    // Zone label
    if (zone.ambientText) {
      ctx.save();
      ctx.globalAlpha = 0.22 + Math.sin(game.time * 0.0008) * 0.06;
      ctx.fillStyle = "#d4d0c8";
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText(zone.ambientText, zone.x, zone.y + zone.radius + 18);
      ctx.restore();
    }
  }

  // ─── Energy Nodes ─────────────────────────────────────────────────
  for (const node of game.energyNodes) {
    if (node.collected) continue;
    if (!isOnScreen(node.x, node.y, 30, camera, canvas)) continue;

    const pulse = 1 + Math.sin(node.phase) * 0.25;
    const r = node.radius * pulse;

    // Outer glow
    const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
    glow.addColorStop(0, "rgba(232, 168, 76, 0.25)");
    glow.addColorStop(0.5, "rgba(232, 168, 76, 0.08)");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.fillStyle = "rgba(240, 192, 96, 0.85)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner bright center
    ctx.fillStyle = "rgba(255, 230, 170, 0.6)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Calibration Objects ──────────────────────────────────────────
  for (const obj of game.calibrationObjects) {
    if (!isOnScreen(obj.x, obj.y, (obj.radius || 30) + 40, camera, canvas)) continue;
    renderCalibrationObject(ctx, obj, game.time);
  }

  // ─── Entities ─────────────────────────────────────────────────────
  for (const entity of game.entities) {
    if (!isOnScreen(entity.x, entity.y, 40, camera, canvas)) continue;
    renderEntity(ctx, entity, game.time);
  }

  // ─── Player Trail ─────────────────────────────────────────────────
  for (const t of game.player.trail) {
    ctx.fillStyle = `rgba(232, 168, 76, ${t.alpha * 0.25})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Player ───────────────────────────────────────────────────────
  const px = game.player.x, py = game.player.y;
  const sightR = playerModel ? playerModel.sightRadius : 120;

  // Sight radius ring (very faint)
  ctx.strokeStyle = "rgba(232, 168, 76, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(px, py, sightR, 0, Math.PI * 2);
  ctx.stroke();

  // Glow
  const pGlow = ctx.createRadialGradient(px, py, 0, px, py, game.player.glowRadius);
  pGlow.addColorStop(0, "rgba(240, 192, 96, 0.35)");
  pGlow.addColorStop(0.5, "rgba(240, 192, 96, 0.1)");
  pGlow.addColorStop(1, "transparent");
  ctx.fillStyle = pGlow;
  ctx.beginPath();
  ctx.arc(px, py, game.player.glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // Core
  const pulse = 1 + Math.sin(game.time * 0.003) * 0.12;
  ctx.fillStyle = "#f0d890";
  ctx.shadowColor = "#e8a84c";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(px, py, game.player.radius * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore(); // end camera transform

  // ─── Fog of War Overlay ───────────────────────────────────────────
  renderFog(game, ctx, canvas, camera);
}

// ─── Fog Rendering ──────────────────────────────────────────────────────────

function renderFog(game, ctx, canvas, camera) {
  // Render fog as semi-transparent black rectangles over unexplored areas
  const startCol = Math.max(0, Math.floor(camera.x / GRID_SIZE));
  const startRow = Math.max(0, Math.floor(camera.y / GRID_SIZE));
  const endCol = Math.min(game.fogCols - 1, Math.ceil((camera.x + canvas.width) / GRID_SIZE));
  const endRow = Math.min(game.fogRows - 1, Math.ceil((camera.y + canvas.height) / GRID_SIZE));

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const idx = r * game.fogCols + c;
      const visibility = game.fogGrid[idx];
      const fogAlpha = 1 - Math.min(1, visibility);

      if (fogAlpha > 0.01) {
        ctx.fillStyle = `rgba(5, 5, 8, ${fogAlpha * 0.92})`;
        ctx.fillRect(
          c * GRID_SIZE - camera.x,
          r * GRID_SIZE - camera.y,
          GRID_SIZE + 1,
          GRID_SIZE + 1
        );
      }
    }
  }
}

// ─── Calibration Object Render ──────────────────────────────────────────────

function renderCalibrationObject(ctx, obj, time) {
  const pulse = 1 + Math.sin(time * (obj.pulseSpeed || 0.002)) * 0.1;
  const r = (obj.radius || 25) * pulse;

  // Glow
  if (obj.glowColor) {
    const glow = ctx.createRadialGradient(obj.x, obj.y, 0, obj.x, obj.y, r * 2);
    glow.addColorStop(0, obj.glowColor);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, r * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fill
  if (obj.color && obj.color !== "transparent") {
    ctx.fillStyle = obj.color;
    ctx.globalAlpha = obj.subtle ? 0.35 : 0.65;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Ring
  ctx.strokeStyle = obj.glowColor || "rgba(200,170,120,0.2)";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(obj.x, obj.y, r + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Label
  if (obj.label) {
    ctx.fillStyle = "rgba(212, 208, 200, 0.55)";
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(obj.label, obj.x, obj.y + r + 16);
  }
}

// ─── Entity Render ──────────────────────────────────────────────────────────

function renderEntity(ctx, entity, time) {
  ctx.save();
  ctx.globalAlpha = entity.alpha;
  ctx.translate(entity.x, entity.y);
  ctx.scale(entity.scale || 1, entity.scale || 1);

  const phase = entity.phase || 0;

  switch (entity.type) {
    case "echo":
    case "whisper":
    case "remnant":
    case "fragment":
      // Concentric rings
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(232, 168, 76, ${0.3 - i*0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + i*7 + Math.sin(phase + i) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;

    case "sentinel":
    case "guardian":
    case "shade":
      // Triangle
      ctx.fillStyle = "rgba(200, 70, 60, 0.5)";
      ctx.beginPath();
      const s = 14;
      ctx.moveTo(0, -s);
      ctx.lineTo(-s*0.866, s*0.5);
      ctx.lineTo(s*0.866, s*0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(240, 100, 80, 0.3)";
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "beacon":
    case "pulse":
      // Warm pulsing light
      const bp = Math.sin(phase * 3) * 0.5 + 0.5;
      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
      bg.addColorStop(0, `rgba(240, 192, 96, ${bp*0.7})`);
      bg.addColorStop(1, "transparent");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      break;

    default:
      // Generic orb
      const og = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
      og.addColorStop(0, "rgba(200, 170, 120, 0.5)");
      og.addColorStop(1, "transparent");
      ctx.fillStyle = og;
      ctx.beginPath();
      ctx.arc(0, 0, 12 + Math.sin(phase) * 2, 0, Math.PI * 2);
      ctx.fill();
  }

  if (entity.loreTag) {
    ctx.globalAlpha = 0.2 + Math.sin(time * 0.001 + phase) * 0.08;
    ctx.fillStyle = "#d4d0c8";
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(entity.loreTag, 0, 28);
  }

  ctx.restore();
}

// ─── Drain Field (for calibration) ──────────────────────────────────────────

export function renderDrainField(ctx, field, time) {
  if (!field) return;
  const pulse = 0.3 + Math.sin(time * 0.001) * 0.05;
  const grad = ctx.createRadialGradient(field.x, field.y, 0, field.x, field.y, field.radius);
  grad.addColorStop(0, `rgba(180, 40, 40, ${pulse * 0.15})`);
  grad.addColorStop(0.7, `rgba(180, 40, 40, ${pulse * 0.08})`);
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(field.x, field.y, field.radius, 0, Math.PI * 2);
  ctx.fill();

  // Warning ring
  ctx.strokeStyle = `rgba(200, 60, 60, ${0.15 + Math.sin(time * 0.002) * 0.05})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.arc(field.x, field.y, field.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Utility ────────────────────────────────────────────────────────────────

function isOnScreen(x, y, margin, camera, canvas) {
  return x > camera.x - margin && x < camera.x + canvas.width + margin
      && y > camera.y - margin && y < camera.y + canvas.height + margin;
}

function hexToRgba(hex, alpha) {
  if (!hex || hex === "transparent") return "rgba(0,0,0,0)";
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lerpColor(c1, c2, t) {
  c1 = c1.replace("#",""); c2 = c2.replace("#","");
  if (c1.length===3) c1=c1[0]+c1[0]+c1[1]+c1[1]+c1[2]+c1[2];
  if (c2.length===3) c2=c2[0]+c2[0]+c2[1]+c2[1]+c2[2]+c2[2];
  const r1=parseInt(c1.slice(0,2),16), g1=parseInt(c1.slice(2,4),16), b1=parseInt(c1.slice(4,6),16);
  const r2=parseInt(c2.slice(0,2),16), g2=parseInt(c2.slice(2,4),16), b2=parseInt(c2.slice(4,6),16);
  const r=Math.round(r1+(r2-r1)*t), g=Math.round(g1+(g2-g1)*t), b=Math.round(b1+(b2-b1)*t);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}
