// CC Comms Panel — local server
// Serves the three panels as static pages, provides a shared key-value
// store (mirroring the get/set/delete/list interface the panels already
// use), pushes live updates over WebSocket, and relays WebRTC signaling
// so pilots/ATC/ground crew can voice chat with each other.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const DATA_FILE = path.join(__dirname, 'data.json');
let kv = {};
try { kv = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { kv = {}; }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(kv), () => {});
  }, 200);
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

app.use(express.json({ limit: '15mb' })); // recorded ATIS audio can be a few MB as base64
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  cacheControl: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

// --- Key/value API (this is what the panels' window.storage calls hit) ---
app.get('/api/kv/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (!(key in kv)) return res.status(404).json({ error: 'not found' });
  res.json({ value: kv[key] });
});

app.post('/api/kv/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  kv[key] = req.body.value;
  persist();
  broadcast({ type: 'kv', key, value: kv[key] });
  res.json({ ok: true });
});

app.delete('/api/kv/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  delete kv[key];
  persist();
  broadcast({ type: 'kv', key, value: null });
  res.json({ ok: true });
});

app.get('/api/kv-list', (req, res) => {
  const prefix = req.query.prefix || '';
  const keys = Object.keys(kv).filter((k) => k.startsWith(prefix));
  res.json({ keys });
});

// --- WebSocket: live push for kv changes + WebRTC signaling relay ---
const clients = new Map(); // ws -> { role, callsign }

wss.on('connection', (ws) => {
  clients.set(ws, { role: 'unknown', callsign: '' });
  console.log(`[ws] client connected (total: ${wss.clients.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === 'presence') {
      clients.set(ws, { role: msg.role || 'unknown', callsign: msg.callsign || '' });
      broadcastPresence();
      return;
    }

    if (msg.type === 'signal') {
      // Relay WebRTC signaling (offer/answer/ICE) to every other connected peer.
      // Small-group mesh — fine for a handful of pilots/ATC/ground crew.
      // Re-stringify (rather than resending the raw buffer) so this always
      // goes out as a text frame — browsers can't JSON.parse a binary frame.
      const text = JSON.stringify(msg);
      const others = [...wss.clients].filter((c) => c !== ws && c.readyState === WebSocket.OPEN);
      console.log(`[signal] ${msg.kind || 'targeted'} from ${msg.from} -> relaying to ${others.length} other client(s)`);
      others.forEach((c) => c.send(text));
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (total: ${wss.clients.size})`);
    broadcastPresence();
  });

  broadcastPresence();
});

function broadcastPresence() {
  const list = [...clients.values()];
  broadcast({ type: 'presence', clients: list });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CC Comms server running at http://localhost:${PORT}`);
  console.log('Panels: /pilot.html  /atc.html  /groundcrew.html');
});
