// Drop-in replacement for the Claude-artifact "window.storage" API, backed by
// this local server. Same shape (get/set/delete/list, shared true/false),
// so none of the panel code that already calls window.storage needs to change.
// shared:true  -> stored on the server, visible to everyone connected to it
// shared:false -> stored in this browser's localStorage only (personal settings)

(function () {
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  let socket = null;
  let reconnectTimer = null;

  function connect() {
    socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => {
      console.log('%c[ccWS]', 'color:#4fc3ff;font-weight:bold', 'connected to', wsUrl);
    });
    socket.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'kv') {
        window.dispatchEvent(new CustomEvent('cc-storage-update', { detail: { key: msg.key, value: msg.value } }));
      } else if (msg.type === 'signal') {
        console.log('%c[ccWS]', 'color:#4fc3ff;font-weight:bold', 'signal received:', msg);
        if (window.__ccVoiceHandleSignal) window.__ccVoiceHandleSignal(msg);
      } else if (msg.type === 'presence' && window.__ccVoicePresence) {
        window.__ccVoicePresence(msg.clients);
      }
    });
    socket.addEventListener('close', () => {
      console.log('%c[ccWS]', 'color:#4fc3ff;font-weight:bold', 'disconnected, retrying in 2s...');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    });
    socket.addEventListener('error', (e) => {
      console.log('%c[ccWS]', 'color:#ff3b30;font-weight:bold', 'WebSocket error', e);
    });
  }
  connect();

  window.__ccSendSignal = function (payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('%c[ccWS]', 'color:#4fc3ff;font-weight:bold', 'sending signal:', payload);
      socket.send(JSON.stringify(Object.assign({ type: 'signal' }, payload)));
    } else {
      console.log('%c[ccWS]', 'color:#ff3b30;font-weight:bold', 'tried to send signal but socket not open, readyState:', socket && socket.readyState);
    }
  };
  window.__ccSendPresence = function (role, callsign) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'presence', role, callsign }));
    }
  };

  window.storage = {
    async get(key, shared) {
      if (!shared) {
        const raw = localStorage.getItem('local:' + key);
        if (raw === null) throw new Error('not found');
        return { key, value: raw, shared };
      }
      const res = await fetch('/api/kv/' + encodeURIComponent(key));
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      return { key, value: data.value, shared };
    },
    async set(key, value, shared) {
      if (!shared) {
        localStorage.setItem('local:' + key, value);
        return { key, value, shared };
      }
      const res = await fetch('/api/kv/' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      return res.ok ? { key, value, shared } : null;
    },
    async delete(key, shared) {
      if (!shared) {
        localStorage.removeItem('local:' + key);
        return { key, deleted: true, shared };
      }
      const res = await fetch('/api/kv/' + encodeURIComponent(key), { method: 'DELETE' });
      return res.ok ? { key, deleted: true, shared } : null;
    },
    async list(prefix, shared) {
      if (!shared) {
        const keys = [];
        const p = 'local:' + (prefix || '');
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(p)) keys.push(k.slice('local:'.length));
        }
        return { keys, prefix, shared };
      }
      const res = await fetch('/api/kv-list?prefix=' + encodeURIComponent(prefix || ''));
      if (!res.ok) return null;
      const data = await res.json();
      return { keys: data.keys, prefix, shared };
    },
  };
})();
