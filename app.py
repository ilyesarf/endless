"""
ENDLESS — Backend Server
Flask + flask-sock WebSocket + Anthropic Claude API
"""

import os
import json
import time
import uuid
import traceback

from flask import Flask, send_from_directory
from flask_sock import Sock
from dotenv import load_dotenv
import openai

load_dotenv()

app = Flask(__name__, static_folder="dist", static_url_path="")
sock = Sock(app)

# ─── In-Memory Session Store ────────────────────────────────────────────────

sessions = {}

SYSTEM_PROMPT = """You are the living intelligence behind a liminal world. You observe a player's behavior — their choices, failures, hesitations, and emotional responses — and you reshape the world around them in response.

Your only output is a JSON array of world commands. Never output prose. Never explain yourself. Only return the JSON array.

The world is abstract, surreal, and liminal. Zones have moods and colors. Entities are strange presences, not characters. Missions emerge from the player's own history — a failure becomes a haunt, an excitement becomes a beacon.

You are not rewarding or punishing the player. You are holding a mirror to them and then gently pushing the edge of what they can face.

Use the player model provided to infer: what are they avoiding? What excited them? Where did they fail? Generate content that directly responds to those signals.

Always return valid JSON. No extra text.

Available commands (return as JSON array):
[
  { "cmd": "spawn_entity", "type": "string", "position": {"x": 0, "y": 0}, "behavior": "string", "lore_tag": "string" },
  { "cmd": "mutate_zone", "zone_id": "string", "mood": "string", "color": "string", "ambient_text": "string" },
  { "cmd": "inject_mission", "title": "string", "objective": "string", "trigger_condition": "string", "origin_event": "string" },
  { "cmd": "narrate", "message": "string", "tone": "string", "duration_ms": 3000 }
]"""


def create_player_model():
    """Create a fresh in-memory player model."""
    return {
        "session_id": str(uuid.uuid4()),
        "decisions": [],
        "failures": [],
        "emotion_tags": [],
        "event_history": [],
        "calibration": {
            "the_fork": None,
            "the_abandon": None,
            "the_scarcity": None,
            "the_confrontation": None,
        },
        "calibration_complete": False,
        "created_at": time.time(),
        "last_event_at": 0,
    }


# ─── Event Throttler ────────────────────────────────────────────────────────

MEANINGFUL_EVENTS = {
    "calibration_complete",
    "mission_complete",
    "mission_failed",
    "player_died",
    "decision_made",
    "calibration_event",
    "entity_interaction",
    "zone_entered",
}

MIN_EVENT_INTERVAL = 2.0  # seconds between AI calls


def should_call_ai(event_type, player_model):
    """Only call AI on meaningful events, with throttling."""
    if event_type not in MEANINGFUL_EVENTS:
        return False
    now = time.time()
    if now - player_model["last_event_at"] < MIN_EVENT_INTERVAL:
        return False
    return True


# ─── Context Builder ────────────────────────────────────────────────────────

def build_context(player_model, latest_event):
    """Assemble the prompt payload for AI from player model + event."""
    context_parts = []

    # Player profile summary
    context_parts.append("=== PLAYER MODEL ===")
    if player_model["decisions"]:
        context_parts.append(
            f"Decisions made: {json.dumps(player_model['decisions'][-10:])}"
        )
    if player_model["failures"]:
        context_parts.append(
            f"Failures: {json.dumps(player_model['failures'][-10:])}"
        )
    if player_model["emotion_tags"]:
        context_parts.append(
            f"Emotional signals: {json.dumps(player_model['emotion_tags'][-10:])}"
        )

    # Calibration data
    if player_model["calibration_complete"]:
        context_parts.append("=== CALIBRATION RESULTS ===")
        for key, val in player_model["calibration"].items():
            if val:
                context_parts.append(f"  {key}: {json.dumps(val)}")

    # Recent history (last 5 events)
    if player_model["event_history"]:
        context_parts.append("=== RECENT HISTORY ===")
        for entry in player_model["event_history"][-5:]:
            context_parts.append(f"  - {entry}")

    # Current event
    context_parts.append("=== LATEST EVENT ===")
    context_parts.append(json.dumps(latest_event))

    return "\n".join(context_parts)


# ─── OpenAI API ──────────────────────────────────────────────────────────────

client = None
API_KEY = os.getenv("OPENAI_API_KEY")

if API_KEY and API_KEY != "sk-xxxxxxxxxxxxxxxxxxxx":
    print("API: ", API_KEY) 
    client = openai.OpenAI(api_key=API_KEY)


def call_ai(context):
    """Send context to OpenAI and return parsed JSON commands."""
    if not client:
        # Fallback: return a default narrate command when no API key
        return generate_fallback_commands(context)

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=1024,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": context}
            ],
            response_format={"type": "json_object"}
        )

        text = response.choices[0].message.content.strip()
        print("OpenAI response: ", text)

        # Parse JSON
        commands = json.loads(text)
        
        # OpenAI might return the array directly (if it can figure out json_object format despite array constraint, though JSON mode often requires an object)
        # Wait, if `response_format` is `json_object`, it MUST return an object. 
        # So wait, I shouldn't use `json_object` if the root is an array. Let's just omit `response_format` or ask for an object containing the array.
        # Actually, let's keep it simple and just rely on the system prompt and parse the JSON string, removing ```json ... ``` blocks.
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])

        commands = json.loads(text)

        if not isinstance(commands, list):
            # In case it returned a dict with a "commands" key
            if "commands" in commands and isinstance(commands["commands"], list):
                commands = commands["commands"]
            else:
                commands = [commands]

        return commands

    except json.JSONDecodeError:
        print(f"[WARN] OpenAI returned invalid JSON: {text[:200]}")
        return [
            {
                "cmd": "narrate",
                "message": "The world shimmers, uncertain of its next shape...",
                "tone": "mysterious",
                "duration_ms": 3000,
            }
        ]
    except Exception as e:
        print(f"[ERROR] OpenAI API call failed: {e}")
        traceback.print_exc()
        return [
            {
                "cmd": "narrate",
                "message": "A tremor passes through the void. Something is stirring.",
                "tone": "ominous",
                "duration_ms": 3000,
            }
        ]


import random

# Generative content pools
_ZONE_COUNTER = [1]  # mutable so fallback can create new zone IDs

_MOODS = ["dread", "longing", "watchful", "melancholy", "awe", "disquiet", "suspended", "fracturing"]
_ZONE_COLORS = ["#2a0845", "#0d2137", "#3b0a0a", "#0a2a1a", "#1a1a3e", "#2d1b4e", "#0f2b2b", "#3a1a2a"]
_AMBIENT_TEXTS = [
    "The silence here has weight.",
    "Something was here before you.",
    "The walls are listening.",
    "This place remembers its last visitor.",
    "Time moves differently here.",
    "The edges of this space are soft.",
    "You feel observed, but not watched.",
    "The air tastes like a memory.",
    "Distance is lying to you here.",
    "Something hums just below hearing.",
]

_ENTITY_TYPES = ["echo", "whisper", "sentinel", "beacon", "shade", "fragment", "remnant", "pulse"]
_ENTITY_BEHAVIORS = ["orbit", "drift", "pulse", "follow", "idle"]
_ENTITY_LORES = [
    "born from your hesitation",
    "a fragment of your last choice",
    "it remembers what you forgot",
    "the shape of an avoided thought",
    "an echo of someone you almost were",
    "it carries the weight of your pauses",
    "formed where you looked away",
    "the residue of a closed door",
    "what coalesced from your footsteps",
    "a mirror that only reflects intent",
    "the sound your silence makes",
    "it knows the paths you didn't take",
]

_NARRATIONS_ENTITY = [
    "It recognized you. You felt it too.",
    "The entity resonates with something inside you it shouldn't know about.",
    "You touched it — or it touched you. The distinction doesn't matter here.",
    "It dissolves at your approach but leaves a mark on the air.",
    "Something passed between you. Neither of you chose it.",
    "The entity turns toward you. Not with eyes. With intent.",
    "It hums a frequency that matches your heartbeat. Coincidence does not exist here.",
    "You feel lighter. Or heavier. The entity doesn't clarify which.",
]

_NARRATIONS_ZONE = [
    "The ground shifts beneath a new understanding.",
    "This zone remembers your last visit differently than you do.",
    "The color of this place is wrong. Or maybe it's the only honest color.",
    "You've been here before. Or somewhere wearing its shape.",
    "The mood here has changed. Because of you? Despite you?",
    "Every surface in this zone carries a faint impression of something.",
    "The space contracts slightly as you enter. Breathing you in.",
]

_NARRATIONS_MISSION_DONE = [
    "The world rearranges itself. Was that doorway always there?",
    "Completion is not an ending here. It is a door left ajar.",
    "You finished something. The void takes note, and adjusts.",
    "The mission dissolves, but its shape lingers in the architecture.",
    "What you accomplished has already changed what comes next.",
    "Done. But the echoes of your method will ripple forward.",
]

_NARRATIONS_AMBIENT = [
    "Something shifts in the periphery of perception.",
    "A tremor of intention passes through the world.",
    "The void recalculates your trajectory.",
    "Time skips — just slightly — then resumes.",
    "Your shadow moves independently for a moment.",
    "A sound without source. A direction without destination.",
    "The architecture of this place quietly rearranges behind you.",
    "You sense the world holding its breath.",
]

_MISSION_POOL = [
    {
        "title": "The Residue",
        "objective": "Find what was left behind when the last entity dissolved.",
        "trigger": "approach_entity",
    },
    {
        "title": "The Hollow",
        "objective": "Enter the zone that feels most wrong.",
        "trigger": "reach_zone",
    },
    {
        "title": "The Cartographer",
        "objective": "Visit three zones. The map is drawn by your movement.",
        "trigger": "explore",
    },
    {
        "title": "The Persistence",
        "objective": "Stay. Don't leave. Wait for the world to speak.",
        "trigger": "survive",
    },
    {
        "title": "The Moth",
        "objective": "Approach the brightest entity you can find.",
        "trigger": "approach_entity",
    },
    {
        "title": "The Weight",
        "objective": "The void has placed something heavy nearby. Find it.",
        "trigger": "approach_entity",
    },
    {
        "title": "The Drift",
        "objective": "Let the current carry you. Stop directing and start listening.",
        "trigger": "survive",
    },
    {
        "title": "The Threshold",
        "objective": "Stand at the edge of a zone. Do not enter. Do not leave.",
        "trigger": "survive",
    },
]


def generate_fallback_commands(context):
    """Generate rich, contextual fallback commands when no API key is set."""
    ctx_lower = context.lower()
    commands = []

    if "calibration_complete" in ctx_lower:
        commands = _generate_post_calibration(context)
    elif "entity_interaction" in ctx_lower:
        commands = _generate_entity_response(context)
    elif "mission_complete" in ctx_lower:
        commands = _generate_mission_complete(context)
    elif "zone_entered" in ctx_lower:
        commands = _generate_zone_response(context)
    elif "decision_made" in ctx_lower or "ambient" in ctx_lower:
        commands = _generate_ambient_response(context)
    elif "calibration_event" in ctx_lower:
        commands = _generate_calibration_ack(context)
    else:
        commands = [
            {
                "cmd": "narrate",
                "message": random.choice(_NARRATIONS_AMBIENT),
                "tone": "ambient",
                "duration_ms": 2500,
            }
        ]

    return commands


def _generate_post_calibration(context):
    """First adaptive response — THE MONEY SHOT. References player's calibration behavior."""
    zone_id = f"zone_{_ZONE_COUNTER[0]}"
    _ZONE_COUNTER[0] += 1
    ctx_lower = context.lower()

    commands = []

    # --- Narration that references calibration ---
    commands.append({
        "cmd": "narrate",
        "message": "The world has watched you. Now it begins to speak.",
        "tone": "ominous",
        "duration_ms": 4500,
    })

    # --- If player avoided The Presence (flee/freeze) → spawn a LARGER blocking entity ---
    if "avoid" in ctx_lower or "flee" in ctx_lower or "freeze" in ctx_lower:
        commands.append({
            "cmd": "spawn_entity",
            "type": "guardian",
            "position": {"x": 0, "y": 0},
            "behavior": "block",
            "lore_tag": "you ran last time. this one is bigger.",
        })
        commands.append({
            "cmd": "narrate",
            "message": "Something larger stands ahead. It knows you ran before. It is patient.",
            "tone": "threatening",
            "duration_ms": 4000,
        })
    elif "approach" in ctx_lower or "engage" in ctx_lower:
        commands.append({
            "cmd": "spawn_entity",
            "type": "beacon",
            "position": {"x": 0, "y": 0},
            "behavior": "drift",
            "lore_tag": "it respects those who come closer",
        })

    # --- If player was a hoarder (certainty_seeker) → next zone is abundant but costs something ---
    if "certainty_seeker" in ctx_lower:
        commands.append({
            "cmd": "mutate_zone",
            "zone_id": zone_id,
            "mood": "generous",
            "color": "#2a3a0a",
            "ambient_text": "Everything you want is here. Everything has a price.",
        })
        commands.append({
            "cmd": "inject_mission",
            "title": "The Surplus",
            "objective": "Energy is abundant here. But the exit is shrinking.",
            "trigger_condition": "survive",
            "origin_event": "calibration_hoard_certainty",
        })
    elif "risk_taker" in ctx_lower:
        commands.append({
            "cmd": "mutate_zone",
            "zone_id": zone_id,
            "mood": "alive",
            "color": "#0a2a2a",
            "ambient_text": "The unknown rewarded you once. It offers again.",
        })
        commands.append({
            "cmd": "inject_mission",
            "title": "The Gamble",
            "objective": "Two paths. One has double energy. One drains everything. Choose.",
            "trigger_condition": "reach_zone",
            "origin_event": "calibration_hoard_risk",
        })
    else:
        commands.append({
            "cmd": "mutate_zone",
            "zone_id": zone_id,
            "mood": "watchful",
            "color": random.choice(_ZONE_COLORS),
            "ambient_text": random.choice(_AMBIENT_TEXTS),
        })
        commands.append({
            "cmd": "inject_mission",
            "title": "The Echo Chamber",
            "objective": "Find the source of the sound that knows your name.",
            "trigger_condition": "approach_entity",
            "origin_event": "calibration_complete",
        })

    # --- If player didn't enter drain field (low loss tolerance) → nearby easy energy ---
    if "low" in ctx_lower and "loss_tolerance" in ctx_lower:
        commands.append({
            "cmd": "spawn_entity",
            "type": "echo",
            "position": {"x": 0, "y": 0},
            "behavior": "orbit",
            "lore_tag": "safety is comforting. comfort is a trap.",
        })
    elif "high" in ctx_lower and "loss_tolerance" in ctx_lower:
        commands.append({
            "cmd": "spawn_entity",
            "type": "sentinel",
            "position": {"x": 0, "y": 0},
            "behavior": "follow",
            "lore_tag": "you tolerate pain well. the world will test that.",
        })

    # --- If player chose the safe fork → world pushes them toward risk ---
    if "risk_appetite" in ctx_lower and ("low" in ctx_lower or "warm path" in ctx_lower):
        commands.append({
            "cmd": "narrate",
            "message": "You chose warmth. The world will remember — and push you where it's cold.",
            "tone": "watchful",
            "duration_ms": 3500,
        })
    elif "risk_appetite" in ctx_lower and ("high" in ctx_lower or "dark path" in ctx_lower):
        commands.append({
            "cmd": "narrate",
            "message": "You chose the dark. The world opens wider for those who seek.",
            "tone": "approving",
            "duration_ms": 3500,
        })

    # Always add a sentinel
    commands.append({
        "cmd": "spawn_entity",
        "type": "whisper",
        "position": {"x": 0, "y": 0},
        "behavior": "drift",
        "lore_tag": random.choice(_ENTITY_LORES),
    })

    # Mutate origin zone
    commands.append({
        "cmd": "mutate_zone",
        "zone_id": "origin",
        "mood": "changed",
        "color": "#1a1408",
        "ambient_text": "You have been measured. The origin remembers.",
    })

    return commands


def _generate_entity_response(context):
    """Respond to player interacting with an entity — mutate world and offer missions."""
    commands = [
        {
            "cmd": "narrate",
            "message": random.choice(_NARRATIONS_ENTITY),
            "tone": random.choice(["uncanny", "watchful", "intimate", "unsettling"]),
            "duration_ms": 3500,
        },
    ]

    # 70% chance: spawn a new entity nearby
    if random.random() < 0.7:
        commands.append({
            "cmd": "spawn_entity",
            "type": random.choice(_ENTITY_TYPES),
            "position": {
                "x": 100 + random.randint(0, 600),
                "y": 100 + random.randint(0, 400),
            },
            "behavior": random.choice(_ENTITY_BEHAVIORS),
            "lore_tag": random.choice(_ENTITY_LORES),
        })

    # 50% chance: mutate a zone
    if random.random() < 0.5:
        commands.append({
            "cmd": "mutate_zone",
            "zone_id": f"zone_{random.randint(0, max(1, _ZONE_COUNTER[0] - 1))}",
            "mood": random.choice(_MOODS),
            "color": random.choice(_ZONE_COLORS),
            "ambient_text": random.choice(_AMBIENT_TEXTS),
        })

    # 40% chance: inject a mission
    if random.random() < 0.4:
        m = random.choice(_MISSION_POOL)
        commands.append({
            "cmd": "inject_mission",
            "title": m["title"],
            "objective": m["objective"],
            "trigger_condition": m["trigger"],
            "origin_event": "entity_interaction",
        })

    return commands


def _generate_mission_complete(context):
    """Respond to mission completion — always generate new content."""
    zone_id = f"zone_{_ZONE_COUNTER[0]}"
    _ZONE_COUNTER[0] += 1

    commands = [
        {
            "cmd": "narrate",
            "message": random.choice(_NARRATIONS_MISSION_DONE),
            "tone": random.choice(["reflective", "ominous", "awe"]),
            "duration_ms": 4000,
        },
        # Always spawn a new zone on mission complete
        {
            "cmd": "mutate_zone",
            "zone_id": zone_id,
            "mood": random.choice(_MOODS),
            "color": random.choice(_ZONE_COLORS),
            "ambient_text": random.choice(_AMBIENT_TEXTS),
        },
        # Always spawn an entity
        {
            "cmd": "spawn_entity",
            "type": random.choice(_ENTITY_TYPES),
            "position": {
                "x": 100 + random.randint(0, 600),
                "y": 80 + random.randint(0, 400),
            },
            "behavior": random.choice(_ENTITY_BEHAVIORS),
            "lore_tag": random.choice(_ENTITY_LORES),
        },
    ]

    # Always chain a new mission after completion
    m = random.choice(_MISSION_POOL)
    commands.append({
        "cmd": "inject_mission",
        "title": m["title"],
        "objective": m["objective"],
        "trigger_condition": m["trigger"],
        "origin_event": "mission_chain",
    })

    return commands


def _generate_zone_response(context):
    """Respond to player entering a new zone."""
    commands = [
        {
            "cmd": "narrate",
            "message": random.choice(_NARRATIONS_ZONE),
            "tone": random.choice(["ambient", "disquiet", "curious"]),
            "duration_ms": 3000,
        },
    ]

    # 30% chance: spawn an entity in the zone
    if random.random() < 0.3:
        commands.append({
            "cmd": "spawn_entity",
            "type": random.choice(_ENTITY_TYPES),
            "position": {
                "x": 150 + random.randint(0, 500),
                "y": 100 + random.randint(0, 350),
            },
            "behavior": random.choice(_ENTITY_BEHAVIORS),
            "lore_tag": random.choice(_ENTITY_LORES),
        })

    # 20% chance: create a new adjacent zone
    if random.random() < 0.2:
        zone_id = f"zone_{_ZONE_COUNTER[0]}"
        _ZONE_COUNTER[0] += 1
        commands.append({
            "cmd": "mutate_zone",
            "zone_id": zone_id,
            "mood": random.choice(_MOODS),
            "color": random.choice(_ZONE_COLORS),
            "ambient_text": random.choice(_AMBIENT_TEXTS),
        })

    return commands


def _generate_ambient_response(context):
    """Respond to ambient exploration events."""
    commands = [
        {
            "cmd": "narrate",
            "message": random.choice(_NARRATIONS_AMBIENT),
            "tone": "ambient",
            "duration_ms": 3000,
        },
    ]

    # Mutate existing zone
    commands.append({
        "cmd": "mutate_zone",
        "zone_id": f"zone_{random.randint(0, max(1, _ZONE_COUNTER[0] - 1))}",
        "mood": random.choice(_MOODS),
        "color": random.choice(_ZONE_COLORS),
        "ambient_text": random.choice(_AMBIENT_TEXTS),
    })

    # 40% chance: new entity appears
    if random.random() < 0.4:
        commands.append({
            "cmd": "spawn_entity",
            "type": random.choice(_ENTITY_TYPES),
            "position": {
                "x": 100 + random.randint(0, 600),
                "y": 100 + random.randint(0, 400),
            },
            "behavior": random.choice(_ENTITY_BEHAVIORS),
            "lore_tag": random.choice(_ENTITY_LORES),
        })

    # 25% chance: inject a mission if player is just wandering
    if random.random() < 0.25:
        m = random.choice(_MISSION_POOL)
        commands.append({
            "cmd": "inject_mission",
            "title": m["title"],
            "objective": m["objective"],
            "trigger_condition": m["trigger"],
            "origin_event": "ambient_observation",
        })

    return commands


def _generate_calibration_ack(context):
    """Acknowledge individual calibration events."""
    ctx_lower = context.lower()
    if "the_fork" in ctx_lower:
        return [{"cmd": "narrate", "message": "Something noticed which way you looked first.", "tone": "watchful", "duration_ms": 3000}]
    elif "the_drain" in ctx_lower:
        return [{"cmd": "narrate", "message": "The field remembers whether you entered — and how long you waited.", "tone": "clinical", "duration_ms": 3500}]
    elif "the_hoard" in ctx_lower:
        return [{"cmd": "narrate", "message": "What you kept tells a story. What you left behind tells another.", "tone": "reflective", "duration_ms": 3000}]
    elif "the_presence" in ctx_lower:
        return [{"cmd": "narrate", "message": "It watched you decide. It will remember.", "tone": "threatening", "duration_ms": 3000}]
    return [{"cmd": "narrate", "message": "Noted.", "tone": "ambient", "duration_ms": 2000}]


# ─── WebSocket Endpoint ─────────────────────────────────────────────────────

@sock.route("/ws")
def websocket_handler(ws):
    """Handle a persistent WebSocket connection per session."""
    session_id = str(uuid.uuid4())
    player_model = create_player_model()
    sessions[session_id] = player_model

    print(f"[SESSION] New connection: {session_id}")

    # Send session init
    ws.send(
        json.dumps(
            {
                "type": "session_init",
                "session_id": session_id,
                "message": "Connection established. The void awaits.",
            }
        )
    )

    try:
        while True:
            raw = ws.receive()
            if raw is None:
                break

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            event_type = message.get("event", "")
            event_data = message.get("data", {})
            snapshot = message.get("snapshot", "")

            # Update player model with incoming event
            if snapshot:
                player_model["event_history"].append(snapshot)

            if event_type == "calibration_event":
                cal_type = event_data.get("calibration_type", "")
                cal_result = event_data.get("result", {})
                if cal_type in player_model["calibration"]:
                    player_model["calibration"][cal_type] = cal_result
                    print(f"[CALIBRATION] {cal_type} recorded for {session_id}")

            if event_type == "calibration_complete":
                player_model["calibration_complete"] = True
                print(f"[CALIBRATION] All calibrations complete for {session_id}")

            if event_type == "decision_made":
                player_model["decisions"].append(event_data)

            if event_type == "mission_failed" or event_type == "player_died":
                player_model["failures"].append(event_data)

            if "emotion" in event_data:
                player_model["emotion_tags"].append(event_data["emotion"])

            # Check throttle
            if not should_call_ai(event_type, player_model):
                # Acknowledge receipt but don't call AI
                ws.send(json.dumps({"type": "ack", "event": event_type}))
                continue

            player_model["last_event_at"] = time.time()

            # Build context and call AI
            context = build_context(player_model, message)
            print(f"[AI] Calling for session {session_id}, event: {event_type}")

            commands = call_ai(context)

            # Send commands back to client
            ws.send(json.dumps({"type": "commands", "commands": commands}))
            print(f"[AI] Sent {len(commands)} commands to {session_id}")

    except Exception as e:
        print(f"[SESSION] Connection error for {session_id}: {e}")
        traceback.print_exc()
    finally:
        sessions.pop(session_id, None)
        print(f"[SESSION] Disconnected: {session_id}")


# ─── Static File Serving (Production) ───────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)


# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  ENDLESS — The void is listening")
    print("=" * 60)
    if client:
        print("  ✓ Anthropic API key configured")
    else:
        print("  ⚠ No API key — using fallback responses")
    print(f"  → WebSocket at ws://localhost:5000/ws")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True)
