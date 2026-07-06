// Renders POI hotspots into screen space from GPS position + compass heading.
// This is "geo-AR": world-anchored labels via bearing math, the Phase 1
// approach (full 3D reconstruction anchoring is Phase 2 / VPS territory).
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

  _elFor(poi) {
    let el = this._els.get(poi.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "hotspot";
      el.innerHTML =
        `<div class="card"><div class="name"></div><div class="dist"></div></div><div class="pin"></div>`;
      el.querySelector(".name").textContent = poi.name;
      el.addEventListener("click", () => this.onTapPoi(poi));
      this.layer.appendChild(el);
      this._els.set(poi.id, el);
    }
    return el;
  }

  render(pois, position, heading, pitch) {
    const w = this.layer.clientWidth;
    const h = this.layer.clientHeight;
    let offLeft = null, offRight = null;

    for (const poi of pois) {
      const el = this._elFor(poi);
      const dist = distanceM(position, poi);
      if (dist > MAX_RANGE_M) { el.style.display = "none"; continue; }

      const rel = bearingDelta(heading, bearingDeg(position, poi));
      if (Math.abs(rel) > FOV / 2 + 8) {
        el.style.display = "none";
        const cand = { poi, dist, rel: Math.abs(rel) };
        if (rel < 0) { if (!offLeft || dist < offLeft.dist) offLeft = cand; }
        else { if (!offRight || dist < offRight.dist) offRight = cand; }
        continue;
      }

      const x = w / 2 + (rel / FOV) * w;
      // Farther things sit higher on screen; pitch shifts the whole horizon.
      const depth = Math.min(1, dist / MAX_RANGE_M);
      const y = h * (0.62 - 0.22 * depth) + pitch * (h / 70);
      const scale = Math.max(0.65, 1.25 - depth * 0.9);

      el.style.display = "";
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.zIndex = String(1000 - Math.round(depth * 999));
      el.querySelector(".card").style.transform = `scale(${scale})`;
      el.querySelector(".dist").textContent = formatDistance(dist);
      el.classList.toggle("near", dist < 80);
    }

    this._edge(this.edgeLeft, offLeft);
    this._edge(this.edgeRight, offRight);
  }

  _edge(el, cand) {
    if (!cand) { el.hidden = true; return; }
    el.hidden = false;
    el.querySelector(".edge-label").textContent =
      `${cand.poi.name} · ${formatDistance(cand.dist)}`;
  }
}
