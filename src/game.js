/**
 * ENDLESS — Game Engine
 * Canvas 2D renderer: player, zones, entities, calibration objects.
 */

export function createGame(canvas) {
  const ctx = canvas.getContext("2d");

  const game = {
    canvas,
    ctx,
    // Player
    player: { x: 0, y: 0, radius: 6, glowRadius: 18, trail: [] },
    // World
    zones: [],
    entities: [],
    missions: [],
    calibrationObjects: [],
    // Input
    keys: {},
    // Camera / viewport
    camera: { x: 0, y: 0 },
    // Current zone
    currentZone: "void",
    // Time
    time: 0,
  };

  // Set canvas to fill container
  function resize() {
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    game.player.x = canvas.width / 2;
    game.player.y = canvas.height / 2;
  }
  resize();
  window.addEventListener("resize", resize);

  // Initialize default zones
  game.zones = [
    {
      id: "zone_0",
      x: canvas.width / 2,
      y: canvas.height / 2,
      radius: 200,
      color: "#0f0f1e",
      targetColor: "#0f0f1e",
      mood: "void",
      targetMood: "void",
      ambientText: "",
      alpha: 0.6,
      transitioning: false,
    },
  ];

  // Input handlers
  window.addEventListener("keydown", (e) => {
    game.keys[e.key.toLowerCase()] = true;
    // Prevent arrow key page scroll
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    game.keys[e.key.toLowerCase()] = false;
  });

  return game;
}

export function updateGame(game, playerModel, dt) {
  game.time += dt;

  // ─── Player Movement ─────────────────────────────────────────────
  const speed = playerModel.speed;
  let dx = 0, dy = 0;

  if (game.keys["w"] || game.keys["arrowup"]) dy -= speed;
  if (game.keys["s"] || game.keys["arrowdown"]) dy += speed;
  if (game.keys["a"] || game.keys["arrowleft"]) dx -= speed;
  if (game.keys["d"] || game.keys["arrowright"]) dx += speed;

  // Normalize diagonal
  if (dx !== 0 && dy !== 0) {
    const norm = 1 / Math.sqrt(2);
    dx *= norm;
    dy *= norm;
  }

  game.player.x = Math.max(10, Math.min(game.canvas.width - 10, game.player.x + dx));
  game.player.y = Math.max(10, Math.min(game.canvas.height - 10, game.player.y + dy));

  // Trail
  if (dx !== 0 || dy !== 0) {
    game.player.trail.push({ x: game.player.x, y: game.player.y, alpha: 0.5 });
    if (game.player.trail.length > 30) game.player.trail.shift();
  }
  for (const t of game.player.trail) {
    t.alpha *= 0.96;
  }
  game.player.trail = game.player.trail.filter((t) => t.alpha > 0.02);

  // ─── Entity Updates ───────────────────────────────────────────────
  for (const entity of game.entities) {
    entity.phase += 0.02;
    entity.alpha = Math.min(1, entity.alpha + 0.01);

    switch (entity.behavior) {
      case "orbit":
        entity.x += Math.cos(entity.phase) * 0.5;
        entity.y += Math.sin(entity.phase) * 0.5;
        break;
      case "drift":
        entity.x += Math.sin(entity.phase * 0.5) * 0.3;
        entity.y -= 0.1;
        break;
      case "pulse":
        entity.scale = 1 + Math.sin(entity.phase * 2) * 0.2;
        break;
      case "follow":
        const fdx = game.player.x - entity.x;
        const fdy = game.player.y - entity.y;
        const fdist = Math.sqrt(fdx * fdx + fdy * fdy);
        if (fdist > 80) {
          entity.x += (fdx / fdist) * 0.3;
          entity.y += (fdy / fdist) * 0.3;
        }
        break;
    }
  }

  // ─── Zone Transitions ─────────────────────────────────────────────
  for (const zone of game.zones) {
    if (zone.transitioning) {
      zone.alpha = Math.min(0.8, zone.alpha + 0.005);
      const elapsed = Date.now() - (zone.transitionStart || Date.now());
      if (elapsed > 2000) {
        zone.color = zone.targetColor;
        zone.mood = zone.targetMood;
        zone.transitioning = false;
      } else {
        zone.color = lerpColor(zone.color, zone.targetColor, 0.02);
      }
    }
  }

  // ─── Zone Detection ───────────────────────────────────────────────
  let inZone = "void";
  for (const zone of game.zones) {
    const zdx = game.player.x - zone.x;
    const zdy = game.player.y - zone.y;
    if (Math.sqrt(zdx * zdx + zdy * zdy) < zone.radius) {
      inZone = zone.id;
    }
  }
  game.currentZone = inZone;
}

export function renderGame(game) {
  const { ctx, canvas } = game;

  // ─── Background ───────────────────────────────────────────────────
  ctx.fillStyle = "#07070c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle grid
  ctx.strokeStyle = "rgba(40, 40, 60, 0.15)";
  ctx.lineWidth = 0.5;
  const gridSize = 60;
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // ─── Zones ────────────────────────────────────────────────────────
  for (const zone of game.zones) {
    const gradient = ctx.createRadialGradient(
      zone.x, zone.y, 0,
      zone.x, zone.y, zone.radius
    );
    gradient.addColorStop(0, hexToRgba(zone.color, zone.alpha * 0.6));
    gradient.addColorStop(0.6, hexToRgba(zone.color, zone.alpha * 0.3));
    gradient.addColorStop(1, "transparent");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    ctx.fill();

    // Ambient text
    if (zone.ambientText) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(game.time * 0.001) * 0.1;
      ctx.fillStyle = "#8b7ec8";
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText(zone.ambientText, zone.x, zone.y + zone.radius + 20);
      ctx.restore();
    }
  }

  // ─── Calibration Objects ──────────────────────────────────────────
  for (const obj of game.calibrationObjects) {
    renderCalibrationObject(ctx, obj, game.time);
  }

  // ─── Entities ─────────────────────────────────────────────────────
  for (const entity of game.entities) {
    renderEntity(ctx, entity, game.time);
  }

  // ─── Player Trail ─────────────────────────────────────────────────
  for (const t of game.player.trail) {
    ctx.fillStyle = `rgba(165, 148, 249, ${t.alpha * 0.3})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Player ───────────────────────────────────────────────────────
  // Outer glow
  const glowGrad = ctx.createRadialGradient(
    game.player.x, game.player.y, 0,
    game.player.x, game.player.y, game.player.glowRadius
  );
  glowGrad.addColorStop(0, "rgba(165, 148, 249, 0.3)");
  glowGrad.addColorStop(0.5, "rgba(165, 148, 249, 0.1)");
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(game.player.x, game.player.y, game.player.glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // Core
  const pulse = 1 + Math.sin(game.time * 0.003) * 0.15;
  ctx.fillStyle = "#c8b8ff";
  ctx.shadowColor = "#a594f9";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(
    game.player.x,
    game.player.y,
    game.player.radius * pulse,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.shadowBlur = 0;
}

function renderCalibrationObject(ctx, obj, time) {
  const pulse = obj.pulseSpeed
    ? 1 + Math.sin(time * obj.pulseSpeed) * 0.15
    : 1 + Math.sin(time * 0.002) * 0.08;

  // Glow
  if (obj.glowColor && obj.glowColor !== "transparent") {
    const glow = ctx.createRadialGradient(
      obj.x, obj.y, 0,
      obj.x, obj.y, obj.radius * 1.8 * pulse
    );
    glow.addColorStop(0, obj.glowColor);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.radius * 1.8 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // Core shape
  if (obj.color && obj.color !== "transparent") {
    ctx.fillStyle = obj.color;
    ctx.globalAlpha = obj.subtle ? 0.4 : 0.7;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Border ring
  ctx.strokeStyle = obj.glowColor || "rgba(100, 100, 150, 0.3)";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(obj.x, obj.y, obj.radius * pulse + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Label
  if (obj.label) {
    ctx.fillStyle = "rgba(200, 200, 220, 0.6)";
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(obj.label, obj.x, obj.y + obj.radius + 18);
  }
}

function renderEntity(ctx, entity, time) {
  ctx.save();
  ctx.globalAlpha = entity.alpha;
  ctx.translate(entity.x, entity.y);
  ctx.scale(entity.scale || 1, entity.scale || 1);

  const phase = entity.phase || 0;

  switch (entity.type) {
    case "echo":
    case "whisper":
      // Rotating rings
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(165, 148, 249, ${0.3 - i * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 12 + i * 8 + Math.sin(phase + i) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;

    case "sentinel":
    case "guardian":
      // Triangle
      ctx.fillStyle = "rgba(200, 60, 60, 0.5)";
      ctx.beginPath();
      const size = 16;
      ctx.moveTo(0, -size);
      ctx.lineTo(-size * 0.866, size * 0.5);
      ctx.lineTo(size * 0.866, size * 0.5);
      ctx.closePath();
      ctx.fill();
      // Inner glow
      ctx.fillStyle = "rgba(250, 100, 100, 0.3)";
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "beacon":
      // Pulsing light
      const beaconPulse = Math.sin(phase * 3) * 0.5 + 0.5;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      grad.addColorStop(0, `rgba(249, 220, 148, ${beaconPulse * 0.8})`);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      break;

    default:
      // Generic pulsing orb
      const orbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
      orbGrad.addColorStop(0, "rgba(148, 165, 249, 0.6)");
      orbGrad.addColorStop(1, "transparent");
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 14 + Math.sin(phase) * 3, 0, Math.PI * 2);
      ctx.fill();
  }

  // Lore tag floating text
  if (entity.loreTag) {
    ctx.globalAlpha = 0.25 + Math.sin(time * 0.001 + phase) * 0.1;
    ctx.fillStyle = "#c8c8d4";
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(entity.loreTag, 0, 30);
  }

  ctx.restore();
}

// ─── Utility ────────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  if (!hex || hex === "transparent") return `rgba(0,0,0,0)`;
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lerpColor(c1, c2, t) {
  c1 = c1.replace("#", "");
  c2 = c2.replace("#", "");
  if (c1.length === 3) c1 = c1[0]+c1[0]+c1[1]+c1[1]+c1[2]+c1[2];
  if (c2.length === 3) c2 = c2[0]+c2[0]+c2[1]+c2[1]+c2[2]+c2[2];

  const r1 = parseInt(c1.slice(0, 2), 16);
  const g1 = parseInt(c1.slice(2, 4), 16);
  const b1 = parseInt(c1.slice(4, 6), 16);
  const r2 = parseInt(c2.slice(0, 2), 16);
  const g2 = parseInt(c2.slice(2, 4), 16);
  const b2 = parseInt(c2.slice(4, 6), 16);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
