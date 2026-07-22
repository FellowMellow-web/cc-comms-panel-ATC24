// Real voice chat over WebRTC. Signaling is relayed through this server's
// WebSocket (see server.js + storage-shim.js). Uses public STUN servers only
// (no TURN) — works reliably on the same LAN as the host, and on many home
// networks; may fail to connect for people behind strict/symmetric NATs.
//
// Mic starts muted. Call ccVoice.setMicEnabled(true/false) from your PTT
// button to actually gate the transmitted audio — that's what makes PTT real
// instead of just a status indicator.

(function () {
  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const myId = Math.random().toString(36).slice(2, 10);
  let localStream = null;
  let peers = {}; // peerId -> RTCPeerConnection
  let voiceActive = false;
  let selectedDeviceId = null;
  let selectedSinkId = null;
  const sinkSupported = !!(typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.setSinkId);

  async function listMics() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch (e) {
      return [];
    }
  }
  async function listSpeakers() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audiooutput');
    } catch (e) {
      return [];
    }
  }
  async function setSpeaker(deviceId) {
    selectedSinkId = deviceId || null;
    if (!sinkSupported) return false;
    const audios = document.querySelectorAll('audio[id^="cc-voice-audio-"]');
    for (const el of audios) {
      try { await el.setSinkId(selectedSinkId || ''); } catch (e) {}
    }
    return true;
  }
  navigator.mediaDevices && navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', () => {
    document.dispatchEvent(new CustomEvent('cc-mic-devices-changed'));
  });

  function log(...args) { console.log('%c[ccVoice]', 'color:#39ff6a;font-weight:bold', ...args); }

  function fireStatus() {
    document.dispatchEvent(new CustomEvent('cc-voice-status', { detail: { active: voiceActive, peerCount: Object.keys(peers).length } }));
  }

  function cleanupPeer(peerId) {
    log('cleanupPeer', peerId);
    if (peers[peerId]) {
      try { peers[peerId].close(); } catch (e) {}
      delete peers[peerId];
    }
    const audioEl = document.getElementById('cc-voice-audio-' + peerId);
    if (audioEl) audioEl.remove();
    fireStatus();
  }

  function createPeerConnection(peerId, isInitiator) {
    log('createPeerConnection', peerId, 'isInitiator:', isInitiator);
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    peers[peerId] = pc;

    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    } else {
      log('WARNING: no localStream when creating peer connection — mic was never captured');
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        log('sending ICE candidate to', peerId);
        window.__ccSendSignal({ to: peerId, from: myId, data: { candidate: e.candidate } });
      } else {
        log('ICE gathering complete for', peerId);
      }
    };

    pc.ontrack = (e) => {
      log('received remote track from', peerId);
      let audioEl = document.getElementById('cc-voice-audio-' + peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'cc-voice-audio-' + peerId;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = e.streams[0];
      if (sinkSupported && selectedSinkId) {
        audioEl.setSinkId(selectedSinkId).catch(() => {});
      }
      const playPromise = audioEl.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch((err) => {
          log('autoplay blocked:', err && err.message);
          // Browser blocked autoplay — needs one more click anywhere to unlock audio.
          document.dispatchEvent(new CustomEvent('cc-voice-audio-blocked'));
        });
      }
    };

    pc.onconnectionstatechange = () => {
      log('connectionState for', peerId, '->', pc.connectionState);
      // 'disconnected' is often transient (brief network blip) and can
      // recover on its own — only tear down on a hard failure or close.
      if (['failed', 'closed'].includes(pc.connectionState)) {
        cleanupPeer(peerId);
      }
      fireStatus();
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        log('negotiationneeded -> creating offer for', peerId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          window.__ccSendSignal({ to: peerId, from: myId, data: { sdp: pc.localDescription } });
          log('sent offer to', peerId);
        } catch (e) {
          log('ERROR creating/sending offer:', e && e.message);
        }
      };
    }

    fireStatus();
    return pc;
  }

  window.__ccVoiceHandleSignal = async function (msg) {
    if (msg.kind === 'hello') {
      log('received hello from', msg.from, '(my own id is', myId + ')', 'voiceActive:', voiceActive);
      if (!voiceActive || msg.from === myId || peers[msg.from]) return;
      createPeerConnection(msg.from, true); // existing member initiates to the new joiner
      return;
    }
    if (msg.kind === 'goodbye') {
      log('received goodbye from', msg.from);
      cleanupPeer(msg.from);
      return;
    }
    if (msg.to !== myId) return; // targeted signaling not for us
    const peerId = msg.from;
    let pc = peers[peerId];
    if (!pc) pc = createPeerConnection(peerId, false);
    try {
      if (msg.data.sdp) {
        log('received', msg.data.sdp.type, 'from', peerId);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
        if (msg.data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          window.__ccSendSignal({ to: peerId, from: myId, data: { sdp: pc.localDescription } });
          log('sent answer to', peerId);
        }
      } else if (msg.data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
      }
    } catch (e) {
      log('ERROR handling signal:', e && e.message);
    }
  };

  async function joinVoice() {
    if (voiceActive) return true;
    log('requesting microphone...');
    try {
      const constraints = { audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      log('microphone access granted, tracks:', localStream.getAudioTracks().length);
    } catch (e) {
      log('ERROR getting microphone:', e && e.message);
      alert('Could not access the microphone. Voice chat needs mic permission, and the page must be loaded over https or localhost.');
      return false;
    }
    localStream.getAudioTracks().forEach((t) => (t.enabled = false)); // muted until PTT is held
    voiceActive = true;
    log('sending hello, my id is', myId);
    window.__ccSendSignal({ kind: 'hello', from: myId });
    fireStatus();
    return true;
  }

  function leaveVoice() {
    if (!voiceActive) return;
    log('leaving voice');
    window.__ccSendSignal({ kind: 'goodbye', from: myId });
    voiceActive = false;
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    Object.keys(peers).forEach(cleanupPeer);
    fireStatus();
  }

  function setMicEnabled(on) {
    if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  async function setMic(deviceId) {
    selectedDeviceId = deviceId;
    if (!voiceActive) return true; // just remembered for the next joinVoice()
    try {
      const wasEnabled = localStream ? localStream.getAudioTracks()[0].enabled : false;
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const newTrack = newStream.getAudioTracks()[0];
      newTrack.enabled = wasEnabled;
      Object.values(peers).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(newTrack);
      });
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      localStream = newStream;
      return true;
    } catch (e) {
      alert('Could not switch to that microphone.');
      return false;
    }
  }

  function unlockAudio() {
    document.querySelectorAll('audio[id^="cc-voice-audio-"]').forEach((el) => {
      el.play().catch(() => {});
    });
  }
  document.addEventListener('click', function firstClickUnlock() {
    unlockAudio();
  }, { passive: true });

  window.ccVoice = {
    joinVoice,
    leaveVoice,
    setMicEnabled,
    setMic,
    listMics,
    setSpeaker,
    listSpeakers,
    unlockAudio,
    get sinkSupported() { return sinkSupported; },
    get active() { return voiceActive; },
    get peerCount() { return Object.keys(peers).length; },
    debugPeers() {
      const info = {};
      Object.entries(peers).forEach(([id, pc]) => {
        info[id] = {
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
        };
      });
      console.table(info);
      return info;
    },
  };
})();
