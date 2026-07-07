// World map with blinking monument markers (equirectangular projection into a
// styled container — no external tiles, so it works offline and under CSP).
import { distanceM, formatDistance } from "./geo.js";

export class WorldMap {
  constructor(container, onSelect) {
    this.el = container;
    this.onSelect = onSelect;
    this.monuments = [];
    this.userPos = null;
  }

  setMonuments(list) { this.monuments = list; this.render(); }
  setUser(pos) { this.userPos = pos; this.render(); }

  // Project lat/lng into the container. To keep markers readable on a phone we
  // frame a window around the monuments rather than the whole globe.
  _project(lat, lng) {
    const lats = this.monuments.map((m) => m.lat).concat(this.userPos ? [this.userPos.lat] : []);
    const lngs = this.monuments.map((m) => m.lng).concat(this.userPos ? [this.userPos.lng] : []);
    const pad = 0.15;
    const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad;
    const minLng = Math.min(...lngs) - pad, maxLng = Math.max(...lngs) + pad;
    const x = (lng - minLng) / Math.max(0.0001, maxLng - minLng);
    const y = (maxLat - lat) / Math.max(0.0001, maxLat - minLat);
    return { x: 8 + x * 84, y: 12 + y * 76 }; // percent, with margins
  }

  render() {
    this.el.innerHTML = "";
    if (this.userPos) {
      const p = this._project(this.userPos.lat, this.userPos.lng);
      const you = document.createElement("div");
      you.className = "map-you";
      you.style.left = `${p.x}%`;
      you.style.top = `${p.y}%`;
      you.title = "You are here";
      this.el.appendChild(you);
    }
    for (const m of this.monuments) {
      const p = this._project(m.lat, m.lng);
      const marker = document.createElement("button");
      marker.className = "map-marker";
      marker.style.left = `${p.x}%`;
      marker.style.top = `${p.y}%`;
      const dist = this.userPos
        ? ` · ${formatDistance(distanceM(this.userPos, m))}`
        : "";
      marker.innerHTML = `<span class="dot"></span><span class="tag">${m.name}${dist}</span>`;
      marker.addEventListener("click", () => this.onSelect(m));
      this.el.appendChild(marker);
    }
  }
}
