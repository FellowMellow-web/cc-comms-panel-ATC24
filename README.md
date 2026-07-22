# CC Comms Panel — Server Setup

This runs the Pilot, ATC, and Ground Crew panels off your PC so everyone's
data (frequencies, PDC, ACARS, ATIS, flight plans, ground services, radar,
and voice chat) actually syncs between them — instead of each panel being an
island the way it was as standalone files.

## 1. Install Node.js

Download and install it from https://nodejs.org (the "LTS" version). This is
a one-time setup step.

## 2. Install and run the server

Open a terminal / command prompt in this folder, then run:

```
npm install
npm start
```

You should see:

```
CC Comms server running at http://localhost:3000
```

Leave that window open — closing it stops the server.

## 3. Open the panels

On your own PC:
- Pilot: http://localhost:3000/pilot.html
- ATC: http://localhost:3000/atc.html
- Ground Crew: http://localhost:3000/groundcrew.html

## 4. Let other people connect (same WiFi/network)

Find your PC's local IP address:
- Windows: open Command Prompt, run `ipconfig`, look for "IPv4 Address"
  (something like `192.168.1.23`)
- Mac: System Settings → Network → the "IP Address" shown there

Anyone else on the same network opens, for example:
`http://192.168.1.23:3000/pilot.html` (swap in your actual IP)

Everything works over plain local network EXCEPT live microphone capture —
see the voice chat note below.

## 5. Voice chat (PTT) and HTTPS

Browsers only allow microphone access on `localhost` or over HTTPS — a plain
`http://192.168.x.x` address will let people see/use everything (radio,
ATIS, PDC, radar, etc.) but their browser will block the mic, so they won't
be able to actually transmit voice.

Easiest fix: use a free tunneling tool like **ngrok** to get an https address
pointing at your server:

```
ngrok http 3000
```

This gives you a URL like `https://something.ngrok-free.app` — share that
instead of your local IP, and voice chat (and everything else) will work for
everyone, including people outside your network. (Requires a free ngrok
account — see https://ngrok.com.)

## Global PTT (works even while Roblox/another window is focused)

Normally PTT only works while the browser tab itself is focused — browsers
block key detection for background tabs, that's a security rule, not a bug.
To get PTT working system-wide (so you can hold the key while tabbed into
PTFS), there's a small companion program in the `ptt-bridge` folder that
listens for the key at the OS level, the same trick apps like Discord use.

**Setup (one-time):**
1. Open a **second** terminal window (leave the main server running in the
   first one)
2. `cd` into the `ptt-bridge` folder
3. `npm install`
4. Open `bridge.js` in Notepad and check the `PTT_KEY` line near the top —
   change it if you want a different key (options are listed in the
   comment above it)
5. `npm start`

You should see:
```
CC PTT Bridge running.
Listening globally for: SPACE
```

Leave that window open too. Then in the panel, click **"ENABLE GLOBAL
PTT"** next to the key bind button — once it says "connected," holding your
key works everywhere, not just while the tab is focused.

This is entirely separate from the main server and is per-person — each
person who wants global PTT runs their own copy of the bridge on their own
PC.

## Notes / limitations

- Voice chat uses WebRTC with public STUN servers only (no TURN relay), so
  it connects directly between browsers. This works great on the same
  network as the host and for most home routers, but some networks
  (symmetric NAT, strict corporate firewalls) may fail to connect.
- Everyone currently holds one shared "on air" per frequency and one voice
  chat room — voice chat is currently global (everyone connected hears
  whoever holds PTT), not filtered by which frequency each person is tuned
  to.
- Each panel has a microphone AND speaker/output selector next to "Join
  Voice Chat." Device names only show up after you've joined voice once
  (browser privacy restriction). Output device switching (setSinkId) is
  supported in Chrome/Edge but not in Firefox or Safari — on those browsers
  the speaker dropdown will show "Not supported," and audio just plays
  through the system default output instead.
- Data is saved to `data.json` in this folder, so restarting the server
  keeps everything (frequencies, flight plans, etc.) from before.
