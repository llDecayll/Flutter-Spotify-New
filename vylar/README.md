# Vylar — Phase 1 MVP

**The world as a living museum.** Point your phone at a heritage site and let an
AI guide narrate what you're seeing.

This is the Phase 1 prototype of the Vylar vision, built as a mobile web app so
it runs on any phone with no install. It implements the four Phase 1 pillars:

| Phase 1 pillar | Implementation |
|---|---|
| GPS-triggered experiences | `watchPosition` + geofencing against the site pack; arrival announcements at each monument |
| Landmark image recognition | **Identify 📷** captures a camera frame and asks Claude vision to name the monument (`/api/identify`) |
| AI narration | Scripted historian narration per monument (TTS via Web Speech API) + free-form **Ask Vylar** Q&A grounded on the site pack (`/api/ask`, Claude-backed) |
| Basic AR labels & hotspots | Camera feed with world-anchored hotspot labels positioned by GPS bearing + device compass, off-screen direction indicators |

The lighthouse site is **Hampi (Vijayanagara)** with 7 curated monuments in
`public/data/hampi.json`. Adding a site = adding a JSON file.

## Run it

```bash
cd vylar
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional — see below
npm start                              # http://localhost:8787
```

- **Live AR** needs HTTPS (or localhost) for camera/GPS/compass permissions.
  For phone testing, tunnel with e.g. `npx localtunnel --port 8787`.
- **Demo tour** (`http://localhost:8787/?demo=1`) needs nothing: it simulates a
  walk through Hampi with a stylized backdrop — drag to look around, tap
  hotspots, use "Walk to next site".
- Without an Anthropic API key the app still works: Ask Vylar answers from the
  offline site pack, and the scanner reports itself unavailable.

## Architecture

```
public/            static mobile web app (no build step)
  js/geo.js        haversine distance / bearing math
  js/sensors.js    LiveSensors (GPS + compass + camera) & DemoSensors (simulated walk)
  js/ar.js         bearing → screen-space projection of hotspots ("geo-AR")
  js/narrator.js   Web Speech TTS + /api client
  js/app.js        app shell, banner, bottom sheet, identify
  data/hampi.json  site pack: POIs, narration scripts, facts, offline Q&A
server.js          static server + /api/ask + /api/identify (Anthropic SDK, claude-opus-4-8)
```

Design decisions worth knowing:

- **Geo-AR, not SLAM.** Phase 1 anchors labels with GPS + compass bearing math.
  Full 3D monument overlays (Phase 2) need visual positioning (ARCore
  Geospatial API / Lightship VPS) and a native Unity client — this prototype
  deliberately stops short of that.
- **Grounded AI.** `/api/ask` stuffs the current monument's curated notes into
  the prompt and instructs the model to flag uncertainty and label legend as
  legend. Offline fallback does keyword matching over hand-written Q&A.
- **Site packs are data.** Everything Hampi-specific lives in one JSON file, so
  the same app serves any site.

## Phase 2 & 3 features (also in this prototype)

| Feature | Implementation |
|---|---|
| Time Travel mode (Phase 2) | 🕰 toggle switches Present ↔ c. 1520 CE: era-tinted view + per-monument "as it was" descriptions from the site pack |
| Historical characters (Phase 2) | Talk to Krishnadevaraya, Domingo Paes, or Chenna the sculptor — persona-grounded Claude roleplay via `/api/character`, honest about being AI portrayals and about fictional composites |
| Guided AR tours (Phase 2) | 🧭 tour engine sequences all monuments with narration; gives distance/direction in live mode, walks you there in demo mode |
| Shared group tours (Phase 3) | 👥 create/join a room code; see companions as blue markers in AR (SSE presence), followers auto-follow the leader's tour stops |
| Treasure hunt / classroom (Phase 3) | 🏺 arrive at monuments, answer relic challenges, collect the full set (persists in localStorage) |
| AR glasses readiness (Phase 4) | WebXR `immersive-ar` detection on the start screen; full architecture in `docs/PHASE4.md` |

## What Phase 2–4 need beyond this prototype

- **Full 3D monument overlays** (the heart of Phase 2) require a native Unity +
  AR Foundation client with visual positioning (ARCore Geospatial API /
  Lightship VPS) and per-site 3D reconstruction content — a content-production
  effort, not just code. This prototype implements the interaction layer
  (time toggle, tours, characters) that the 3D layer plugs into.
- **Phase 3 at scale** needs a real-time backend (the in-memory SSE room server
  here is the reference behavior for it).
- **Phase 4** is hardware-gated — see `docs/PHASE4.md`.
