# Vylar Phase 4 — AR Glasses & City-Scale Persistent AR

Phase 4 is **hardware- and platform-gated**: it cannot be shipped as part of this
web prototype. This document is the concrete architecture for when the
prerequisites exist. What *is* already in the prototype: WebXR `immersive-ar`
capability detection on the start screen, and a data model (site packs, POIs,
tours, rooms) that carries forward unchanged.

## 1. Target platforms

| Platform | Path | Status |
|---|---|---|
| Apple Vision Pro / visionOS | Native app (RealityKit + ARKit), or Unity PolySpatial | Shipping hardware; no outdoor GPS AR story yet — best for indoor/museum mode |
| Android XR (Samsung et al.) | Unity + AR Foundation, OpenXR | The most direct fit: ARCore Geospatial API carries over |
| WebXR (`immersive-ar`) | The existing web app, progressive enhancement | Works today on some Android browsers; use as the low-friction tier |

Strategy: keep **one Unity codebase** (already the Phase 2/3 recommendation)
targeting phone AR first; glasses become an additional build target via OpenXR
rather than a rewrite.

## 2. City-scale persistent AR

The core problem is **persistent, shared world anchoring** at centimeter
accuracy across square kilometers:

- **Localization**: ARCore Geospatial API / Lightship VPS where Street View
  coverage exists; for heritage sites without coverage, build our own VPS layer
  from site scans (photogrammetry / gaussian splats captured during content
  production — dual-purpose the capture).
- **Anchor service**: our own persistent anchor store keyed by site pack
  (`site_id → anchors[] → {geo pose, refinement features, content ref}`).
  Cloud Anchors-style third-party stores create vendor lock-in on exactly the
  asset we must own.
- **Content streaming**: tiled 3D content (3D Tiles / glTF) streamed by
  geohash cell, LOD by distance; offline site packs remain the unit of
  download (connectivity at remote sites is the binding constraint).
- **Persistence semantics**: anchors + user state (found relics, tour
  progress) sync through the same room/session service built in Phase 3 —
  the SSE room server in this prototype is the toy version of that service.

## 3. Real-time AI companions

The Phase 2 character chat already implements the interaction model
(persona-grounded, stateless server, client-held history). Glasses-era
upgrades:

- **Voice-first loop**: streaming STT → Claude (streaming) → TTS; barge-in
  support. Latency budget ~1.2s to first audio.
- **Embodied avatars**: characters get a spatial position (an anchor), gaze
  and gesture; they walk with the visitor (path along a navmesh baked into
  the site pack).
- **Continuous context**: camera-frame sampling (the `/api/identify` flow, on
  an interval, on-device pre-filtered) so the companion knows what the visitor
  is looking at without being asked.

## 4. What must be true before starting Phase 4

1. Phase 2's VPS-anchored 3D overlays are in production at ≥1 site (proves the
   anchor + streaming stack at site scale before city scale).
2. A glasses platform with outdoor camera-based localization ships in the
   target market (India) in meaningful volume.
3. The content pipeline produces splat/mesh captures as a byproduct — the
   capture archive *is* the city-scale localization dataset.
