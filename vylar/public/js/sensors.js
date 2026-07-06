// Sensor sources for the AR view. Both classes expose the same surface:
//   .position  {lat, lng} | null
//   .heading   degrees clockwise from north
//   .pitch     degrees (0 = level, + = looking up)
//   .start()   async; may throw if permissions are denied
//   .stop()
import { offsetM, bearingDeg } from "./geo.js";

export class LiveSensors {
  constructor() {
    this.position = null;
    this.heading = 0;
    this.pitch = 0;
    this.isDemo = false;
    this._watchId = null;
    this._onOrient = this._onOrient.bind(this);
  }

  async start() {
    // iOS requires an explicit permission request from a user gesture.
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      const state = await DeviceOrientationEvent.requestPermission();
      if (state !== "granted") throw new Error("Motion permission denied");
    }
    window.addEventListener("deviceorientationabsolute", this._onOrient, true);
    window.addEventListener("deviceorientation", this._onOrient, true);

    await new Promise((resolve, reject) => {
      this._watchId = navigator.geolocation.watchPosition(
        (p) => {
          this.position = { lat: p.coords.latitude, lng: p.coords.longitude };
          resolve();
        },
        (err) => reject(new Error(`Location error: ${err.message}`)),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
      );
    });
  }

  _onOrient(e) {
    if (typeof e.webkitCompassHeading === "number") {
      this.heading = e.webkitCompassHeading; // iOS: already compass degrees
    } else if (e.absolute && typeof e.alpha === "number") {
      this.heading = (360 - e.alpha) % 360;
    } else if (typeof e.alpha === "number" && this.heading === 0) {
      this.heading = (360 - e.alpha) % 360; // best effort without absolute
    }
    if (typeof e.beta === "number") this.pitch = Math.max(-45, Math.min(45, e.beta - 90));
  }

  stop() {
    if (this._watchId != null) navigator.geolocation.clearWatch(this._watchId);
    window.removeEventListener("deviceorientationabsolute", this._onOrient, true);
    window.removeEventListener("deviceorientation", this._onOrient, true);
  }
}

// Simulates a visitor at the site: stands ~50m from each POI, faces it,
// slowly auto-pans until the user drags to look around, and can "walk"
// to the next POI on demand.
export class DemoSensors {
  constructor(site, viewportEl) {
    this.site = site;
    this.isDemo = true;
    this.pitch = 0;
    this._stopIndex = 0;
    this._autoPan = true;
    this._dragging = false;
    this._el = viewportEl;
    this._walk = null;
    this._placeAt(site.pois[0]);
    this._bindDrag();
  }

  _placeAt(poi) {
    this.position = offsetM(poi, -50, 12); // ~50m south of the POI
    this._baseHeading = bearingDeg(this.position, poi);
    this.heading = this._baseHeading;
  }

  async start() {}
  stop() {}

  get currentStop() {
    return this.site.pois[this._stopIndex];
  }

  nextStop() {
    this._stopIndex = (this._stopIndex + 1) % this.site.pois.length;
    const poi = this.site.pois[this._stopIndex];
    const from = { ...this.position };
    const to = offsetM(poi, -50, 12);
    const t0 = performance.now();
    const DURATION = 2500;
    this._walk = { from, to, t0, DURATION, poi };
    return poi;
  }

  tick(dtMs) {
    if (this._walk) {
      const { from, to, t0, DURATION, poi } = this._walk;
      const t = Math.min(1, (performance.now() - t0) / DURATION);
      const e = t * t * (3 - 2 * t); // smoothstep
      this.position = {
        lat: from.lat + (to.lat - from.lat) * e,
        lng: from.lng + (to.lng - from.lng) * e,
      };
      this._baseHeading = bearingDeg(this.position, poi);
      this.heading = this._baseHeading;
      if (t >= 1) this._walk = null;
      return;
    }
    if (this._autoPan && !this._dragging) {
      // Gentle sway around the current stop so the scene feels alive but the
      // marker never leaves the screen. Stops as soon as the user drags.
      this.heading =
        (this._baseHeading + 14 * Math.sin(performance.now() / 2400) + 360) % 360;
    }
  }

  _bindDrag() {
    let lastX = 0, lastY = 0;
    this._el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, #sheet, #controls, #hud")) return;
      this._dragging = true;
      this._autoPan = false;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("pointermove", (e) => {
      if (!this._dragging) return;
      this.heading = (this.heading - (e.clientX - lastX) * 0.25 + 360) % 360;
      this.pitch = Math.max(-30, Math.min(30, this.pitch + (e.clientY - lastY) * 0.15));
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("pointerup", () => (this._dragging = false));
  }
}
