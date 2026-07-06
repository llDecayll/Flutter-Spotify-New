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

## Roadmap from here (per the product vision)

- Phase 2: full 3D monument overlays (Unity + AR Foundation + VPS), historical
  character interactions, guided tours.
- Phase 3: multiplayer/shared tours, live events, classroom mode.
- Phase 4: AR glasses, city-scale persistent AR.
