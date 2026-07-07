// Renders POI hotspots (and group-member markers) into screen space from GPS
// position + compass heading. This is "geo-AR": world-anchored labels via
// bearing math, the Phase 1 approach (full 3D reconstruction anchoring is
// Phase 2 / VPS territory).
import { distanceM, bearingDeg, bearingDelta, formatDistance } from "./geo.js";

const FOV = 62;            // horizontal degrees mapped across the viewport
const MAX_RANGE_M = 2500;  // don't render hotspots farther than this

export class ARView {
  constructor({ layer, edgeLeft, edgeRight, onTapPoi }) {
    this.layer = layer;
    this.edgeLeft = edgeLeft;
    this.edgeRight = edgeRight;
    this.onTapPoi = onTapPoi;
    this._els = new Map();
  }

  _elFor(key, label, target, isMember) {
    let el = this._els.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = isMember ? "hotspot member" : "hotspot";
      el.innerHTML =
        `<div class="card"><div class="name"></div><div class="dist"></div></div><div class="pin"></div>`;
      el._nameEl = el.querySelector(".name");
      el._distEl = el.querySelector(".dist");
      el._cardEl = el.querySelector(".card");
      el._prev = {}; // last-applied values, to skip redundant DOM writes
      if (!isMember) el.addEventListener("click", () => this.onTapPoi(target));
      this.layer.appendChild(el);
      this._els.set(key, el);
    }
    if (el._prev.label !== label) { el._nameEl.textContent = label; el._prev.label = label; }
    return el;
  }

  render(pois, position, heading, pitch, members = []) {
    const w = this.layer.clientWidth;
    const h = this.layer.clientHeight;
    let offLeft = null, offRight = null;
    const liveKeys = new Set();

    const place = (key, label, target, isMember) => {
      liveKeys.add(key);
      const el = this._elFor(key, label, target, isMember);
      const p = el._prev;
      const dist = distanceM(position, target);
      const hide = () => {
        if (p.display !== "none") { el.style.display = "none"; p.display = "none"; }
      };
      if (dist > MAX_RANGE_M) { hide(); return; }

      const rel = bearingDelta(heading, bearingDeg(position, target));
      if (Math.abs(rel) > FOV / 2 + 8) {
        hide();
        if (!isMember) {
          const cand = { label, dist };
          if (rel < 0) { if (!offLeft || dist < offLeft.dist) offLeft = cand; }
          else { if (!offRight || dist < offRight.dist) offRight = cand; }
        }
        return;
      }

      const x = w / 2 + (rel / FOV) * w;
      // Farther things sit higher on screen; pitch shifts the whole horizon.
      const depth = Math.min(1, dist / MAX_RANGE_M);
      const y = h * (0.62 - 0.22 * depth) + pitch * (h / 70);
      const scale = Math.max(0.65, 1.25 - depth * 0.9);
      const z = 1000 - Math.round(depth * 999);
      const distLabel = formatDistance(dist);
      const near = !isMember && dist < 80;

      // Write only what changed; round positions to whole pixels so sub-pixel
      // jitter from sensor noise doesn't trigger a paint every frame.
      if (p.display !== "") { el.style.display = ""; p.display = ""; }
      const xr = Math.round(x), yr = Math.round(y);
      if (xr !== p.x) { el.style.left = `${xr}px`; p.x = xr; }
      if (yr !== p.y) { el.style.top = `${yr}px`; p.y = yr; }
      if (z !== p.z) { el.style.zIndex = String(z); p.z = z; }
      if (scale.toFixed(2) !== p.scale) { el._cardEl.style.transform = `scale(${scale.toFixed(2)})`; p.scale = scale.toFixed(2); }
      if (distLabel !== p.distLabel) { el._distEl.textContent = distLabel; p.distLabel = distLabel; }
      if (near !== p.near) { el.classList.toggle("near", near); p.near = near; }
    };

    for (const poi of pois) place(poi.id, poi.name, poi, false);
    for (const m of members) place(`member:${m.id}`, m.name, m, true);

    // Drop markers for members who left the room.
    for (const [key, el] of this._els) {
      if (key.startsWith("member:") && !liveKeys.has(key)) {
        el.remove();
        this._els.delete(key);
      }
    }

    this._edge(this.edgeLeft, offLeft);
    this._edge(this.edgeRight, offRight);
  }

  _edge(el, cand) {
    if (!cand) { el.hidden = true; return; }
    el.hidden = false;
    el.querySelector(".edge-label").textContent =
      `${cand.label} · ${formatDistance(cand.dist)}`;
  }
}
