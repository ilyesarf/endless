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
import anthropic

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

MIN_EVENT_INTERVAL = 2.0  # seconds between Claude calls


def should_call_claude(event_type, player_model):
    """Only call Claude on meaningful events, with throttling."""
    if event_type not in MEANINGFUL_EVENTS:
        return False
    now = time.time()
    if now - player_model["last_event_at"] < MIN_EVENT_INTERVAL:
        return False
    return True


# ─── Context Builder ────────────────────────────────────────────────────────

def build_context(player_model, latest_event):
    """Assemble the prompt payload for Claude from player model + event."""
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


# ─── Claude API ──────────────────────────────────────────────────────────────

client = None
API_KEY = os.getenv("ANTHROPIC_API_KEY")

if API_KEY and API_KEY != "sk-ant-xxxxxxxxxxxxxxxxxxxx":
    client = anthropic.Anthropic(api_key=API_KEY)


def call_claude(context):
    """Send context to Claude and return parsed JSON commands."""
    if not client:
        # Fallback: return a default narrate command when no API key
        return generate_fallback_commands(context)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": context}],
        )

        text = response.content[0].text.strip()

        # Try to parse JSON — Claude should return only JSON
        # Handle potential markdown wrapping
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])

        commands = json.loads(text)

        if not isinstance(commands, list):
            commands = [commands]

        return commands

    except json.JSONDecodeError:
        print(f"[WARN] Claude returned invalid JSON: {text[:200]}")
        return [
            {
                "cmd": "narrate",
                "message": "The world shimmers, uncertain of its next shape...",
                "tone": "mysterious",
                "duration_ms": 3000,
            }
        ]
    except Exception as e:
        print(f"[ERROR] Claude API call failed: {e}")
        traceback.print_exc()
        return [
            {
                "cmd": "narrate",
                "message": "A tremor passes through the void. Something is stirring.",
                "tone": "ominous",
                "duration_ms": 3000,
            }
        ]


def generate_fallback_commands(context):
    """Generate contextual fallback commands when no API key is set."""
    ctx_lower = context.lower()

    commands = []

    if "calibration_complete" in ctx_lower:
        commands = [
            {
                "cmd": "narrate",
                "message": "The void has studied you. It knows your shape now.",
                "tone": "ominous",
                "duration_ms": 4000,
            },
            {
                "cmd": "mutate_zone",
                "zone_id": "zone_0",
                "mood": "watchful",
                "color": "#2a0845",
                "ambient_text": "The silence here has weight.",
            },
            {
                "cmd": "spawn_entity",
                "type": "echo",
                "position": {"x": 500, "y": 300},
                "behavior": "orbit",
                "lore_tag": "born from your hesitation",
            },
            {
                "cmd": "inject_mission",
                "title": "The Echo Chamber",
                "objective": "Find the source of the sound that knows your name.",
                "trigger_condition": "approach_entity",
                "origin_event": "calibration_complete",
            },
        ]
    elif "fork" in ctx_lower:
        commands = [
            {
                "cmd": "narrate",
                "message": "Something noticed which way you looked first.",
                "tone": "watchful",
                "duration_ms": 3000,
            }
        ]
    elif "abandon" in ctx_lower:
        commands = [
            {
                "cmd": "narrate",
                "message": "The exit you found was not an exit. It was a question.",
                "tone": "reflective",
                "duration_ms": 3500,
            }
        ]
    elif "scarcity" in ctx_lower:
        commands = [
            {
                "cmd": "narrate",
                "message": "Your resources tell a story about what you value.",
                "tone": "clinical",
                "duration_ms": 3000,
            }
        ]
    elif "confrontation" in ctx_lower:
        commands = [
            {
                "cmd": "narrate",
                "message": "It watched you decide. It will remember.",
                "tone": "threatening",
                "duration_ms": 3000,
            }
        ]
    elif "mission_complete" in ctx_lower or "decision_made" in ctx_lower:
        commands = [
            {
                "cmd": "mutate_zone",
                "zone_id": "zone_0",
                "mood": "shifting",
                "color": "#1a1a3e",
                "ambient_text": "The ground remembers your footsteps.",
            },
            {
                "cmd": "spawn_entity",
                "type": "whisper",
                "position": {"x": 400, "y": 250},
                "behavior": "drift",
                "lore_tag": "a fragment of your last choice",
            },
            {
                "cmd": "narrate",
                "message": "The world rearranges itself. Was that doorway always there?",
                "tone": "uncanny",
                "duration_ms": 3500,
            },
        ]
    else:
        commands = [
            {
                "cmd": "narrate",
                "message": "Something shifts in the periphery of perception.",
                "tone": "ambient",
                "duration_ms": 2500,
            }
        ]

    return commands


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
            if not should_call_claude(event_type, player_model):
                # Acknowledge receipt but don't call Claude
                ws.send(json.dumps({"type": "ack", "event": event_type}))
                continue

            player_model["last_event_at"] = time.time()

            # Build context and call Claude
            context = build_context(player_model, message)
            print(f"[CLAUDE] Calling for session {session_id}, event: {event_type}")

            commands = call_claude(context)

            # Send commands back to client
            ws.send(json.dumps({"type": "commands", "commands": commands}))
            print(f"[CLAUDE] Sent {len(commands)} commands to {session_id}")

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
