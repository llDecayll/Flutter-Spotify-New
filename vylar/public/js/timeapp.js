import { TimeMachine } from "./timemachine.js";
import { WorldMap } from "./map.js";
import { Narrator } from "./narrator.js";
import { distanceM, formatDistance } from "./geo.js";

const $ = (id) => document.getElementById(id);
const narrator = new Narrator();

const state = {
  monuments: [],
  userPos: null,
  tm: null,
  monument: null,
  eraIndex: 0,
  yaw: 0,
  pitch: 0,
};

async function init() {
  const { monuments } = await (await fetch("/api/monuments")).json();
  state.monuments = monuments;

  // User position: real GPS with ?live=1, otherwise a simulated spot ~2.6 km
  // from the Taj so the "nearby monument" flow is demonstrable anywhere.
  const params = new URLSearchParams(location.search);
  if (params.get("live") === "1" && navigator.geolocation) {
    await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => { state.userPos = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(); },
        () => resolve(),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });
  }
  if (!state.userPos) state.userPos = { lat: 27.1985, lng: 78.0421 }; // ~2.6 km N of the Taj

  const map = new WorldMap($("map-canvas"), openTimeMachine);
  map.setMonuments(state.monuments);
  map.setUser(state.userPos);
  state.map = map;

  // Geofence: nearest monument within range -> notification (the "background
  // alert while travelling" step; real background push is native — see docs).
  const nearest = nearestMonument();
  if (nearest) {
    $("notify-title").textContent = `${nearest.m.name} is nearby`;
    $("notify-sub").textContent =
      `${nearest.m.place} · ${formatDistance(nearest.dist)} away — travel through its history in AR.`;
    $("tm-notify").hidden = false;
    maybeSystemNotification(nearest);
  } else {
    showMap();
  }

  $("notify-open").addEventListener("click", showMap);
  $("tm-back").addEventListener("click", backToMap);
  $("tm-narrate").addEventListener("click", () => {
    const on = narrator.toggle();
    $("tm-narrate").textContent = on ? "🔊" : "🔇";
  });
  $("tm-slider").addEventListener("input", () => selectEra(Number($("tm-slider").value)));
}

function nearestMonument() {
  let best = null;
  for (const m of state.monuments) {
    const dist = distanceM(state.userPos, m);
    if (!best || dist < best.dist) best = { m, dist };
  }
  return best && best.dist < 200000 ? best : null; // 200 km demo radius
}

// Best-effort system notification. Real geofenced background push needs a
// native app / push service; this only fires if the tab is granted permission.
function maybeSystemNotification(nearest) {
  if (!("Notification" in window)) return;
  const fire = () => new Notification("Vylar — historical place nearby", {
    body: `${nearest.m.name} · ${formatDistance(nearest.dist)} away`,
  });
  if (Notification.permission === "granted") { try { fire(); } catch {} }
  else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => { if (p === "granted") { try { fire(); } catch {} } });
  }
}

function showMap() {
  $("tm-notify").hidden = true;
  $("tm-view").hidden = true;
  $("tm-map").hidden = false;
}

async function openTimeMachine(monument) {
  state.monument = monument;
  state.eraIndex = monument.timeline.length - 1; // start at "today"
  $("tm-map").hidden = true;
  $("tm-view").hidden = false;
  $("tm-title").textContent = monument.name;

  if (!state.tm) {
    state.tm = new TimeMachine($("tm-canvas"));
    state.tm.start();
    bindLookAround();
  }

  const slider = $("tm-slider");
  slider.max = String(monument.timeline.length - 1);
  slider.value = String(state.eraIndex);
  $("tm-ticks").innerHTML = monument.timeline
    .map((e) => `<span>${e.label}</span>`).join("");

  await enableDeviceOrientation();
  selectEra(state.eraIndex);
}

async function selectEra(index) {
  const era = state.monument.timeline[index];
  state.eraIndex = index;
  $("tm-slider").value = String(index);
  $("tm-era-label").textContent = `${era.label} — ${era.title}`;
  state.tm.setEra(era);
  $("tm-absent").hidden = era.state !== "absent";
  window.__tmEra = { index, label: era.label, state: era.state, hasMonument: state.tm.hasMonument() };

  const out = $("tm-narration");
  out.classList.add("loading");
  out.textContent = "Travelling to " + era.label + "…";
  try {
    const res = await fetch("/api/timeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monumentId: state.monument.id, year: era.year }),
    });
    const { narration, source } = await res.json();
    out.classList.remove("loading");
    out.textContent = "";
    out.append(narration);
    const src = document.createElement("span");
    src.className = "src";
    src.textContent = source === "ai" ? "— Vylar time guide (Fable 5)" : "— offline timeline notes";
    out.append(src);
    narrator.speak(narration);
  } catch (err) {
    out.classList.remove("loading");
    out.textContent = era.seed;
  }
}

function backToMap() {
  narrator.stopSpeaking();
  showMap();
}

/* ---- Look-around: device orientation (phones) + drag (desktop/test) ---- */
async function enableDeviceOrientation() {
  try {
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch {}
}

function bindLookAround() {
  const onOrient = (e) => {
    if (typeof e.alpha !== "number") return;
    state.yaw = -(e.alpha * Math.PI) / 180;
    if (typeof e.beta === "number") state.pitch = ((e.beta - 90) * Math.PI) / 180;
    state.tm.look(state.yaw, state.pitch);
  };
  window.addEventListener("deviceorientation", onOrient, true);

  const canvas = $("tm-canvas");
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    state.yaw -= (e.clientX - lastX) * 0.005;
    state.pitch += (e.clientY - lastY) * 0.005;
    lastX = e.clientX; lastY = e.clientY;
    state.tm.look(state.yaw, state.pitch);
  });
  window.addEventListener("pointerup", () => { dragging = false; });
}

// Pause rendering when the tab is hidden (battery/thermal).
document.addEventListener("visibilitychange", () => {
  if (!state.tm) return;
  if (document.hidden) { state.tm.stop(); narrator.stopSpeaking(); }
  else { state.tm.start(); }
});

// Test hook: expose whether the canvas has drawn non-blank pixels.
window.__tmReady = () => !!state.tm;

init();
