/**
 * ENDLESS — WebSocket Client
 * Manages persistent connection to Flask backend.
 */

let socket = null;
let messageHandler = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000;

export function connect(onMessage) {
  messageHandler = onMessage;
  _connect();
}

function _connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}/ws`;

  console.log(`[WS] Connecting to ${url}...`);
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("[WS] Connected");
    updateConnectionStatus(true);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (messageHandler) {
        messageHandler(data);
      }
    } catch (err) {
      console.error("[WS] Failed to parse message:", err);
    }
  };

  socket.onclose = () => {
    console.log("[WS] Disconnected");
    updateConnectionStatus(false);
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.error("[WS] Error:", err);
    updateConnectionStatus(false);
  };
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      console.log("[WS] Attempting reconnect...");
      reconnectTimer = null;
      _connect();
    }, RECONNECT_DELAY);
  }
}

function updateConnectionStatus(connected) {
  const dot = document.getElementById("connection-status");
  if (dot) {
    dot.classList.toggle("connected", connected);
    dot.classList.toggle("disconnected", !connected);
  }
}

export function send(eventType, data = {}, snapshot = "") {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("[WS] Not connected, queuing event:", eventType);
    return false;
  }

  const message = {
    event: eventType,
    data: data,
    snapshot: snapshot,
    timestamp: Date.now(),
  };

  socket.send(JSON.stringify(message));
  return true;
}

export function isConnected() {
  return socket && socket.readyState === WebSocket.OPEN;
}
