import { distanceM, bearingDeg, formatDistance, compassPoint } from "./geo.js";
import { LiveSensors, DemoSensors } from "./sensors.js";
import { ARView } from "./ar.js";
import { Narrator } from "./narrator.js";
import { CharacterChat } from "./characters.js";
import { GroupTour } from "./rooms.js";
import { TreasureHunt } from "./hunt.js";

const $ = (id) => document.getElementById(id);

const state = {
  site: null,
  sensors: null,
  ar: null,
  narrator: new Narrator(),
  chat: null,
  group: null,
  hunt: null,
  members: [],
  announcedPoi: null,
  nearestPoi: null,
  pastMode: false,
  tour: { active: false, index: -1 },
  lastFrame: performance.now(),
  lastRender: 0,
  panoramaEl: null,
  banner: { title: "", sub: "", pan: null },
  running: false,
};

// AR hotspots track GPS + compass, which change far slower than the display's
// refresh rate. Capping the heavy re-layout to ~15 fps (instead of 60) roughly
// quarters the per-frame CPU/GPU work — the single biggest lever against the
// device heating up during a session.
const RENDER_INTERVAL_MS = 66;

async function init() {
  state.site = await (await fetch("/data/hampi.json")).json();
  $("start-site-name").textContent = state.site.name;
  $("start-site-desc").textContent = state.site.intro.split(". ").slice(0, 2).join(". ") + ".";

  // Phase 4 readiness: report WebXR immersive-ar capability (AR glasses /
  // XR browsers). The experience itself is phone-first for now.
  if (navigator.xr?.isSessionSupported) {
    try {
      const ok = await navigator.xr.isSessionSupported("immersive-ar");
      $("xr-status").textContent = ok
        ? "✦ WebXR AR device detected — immersive mode available."
        : "WebXR present, but no immersive-ar device — phone mode.";
    } catch {
      $("xr-status").textContent = "";
    }
  }

  $("btn-live").addEventListener("click", () => start("live"));
  $("btn-demo").addEventListener("click", () => start("demo"));

  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") start("demo");
}

async function start(mode) {
  const arView = $("ar-view");

  if (mode === "live") {
    state.sensors = new LiveSensors();
    try {
      await state.sensors.start();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      $("camera").srcObject = stream;
    } catch (err) {
      toast(`Live AR unavailable (${err.message}). Switching to the demo tour.`);
      state.sensors.stop?.();
      mode = "demo";
    }
  }

  if (mode === "demo") {
    state.sensors = new DemoSensors(state.site, arView);
    $("camera").hidden = true;
    $("demo-scene").hidden = false;
    $("btn-next").hidden = false;
  }

  $("start-screen").hidden = true;
  arView.hidden = false;

  state.ar = new ARView({
    layer: $("hotspot-layer"),
    edgeLeft: $("edge-left"),
    edgeRight: $("edge-right"),
    onTapPoi: openSheet,
  });

  state.chat = new CharacterChat(state.site, state.narrator, () => $("sheet").dataset.poiId || null);
  state.hunt = new TreasureHunt(state.site, toast, state.narrator);
  state.group = new GroupTour({
    getPosition: () => state.sensors?.position,
    toast,
    onRoster: (members) => (state.members = members),
    onLeaderStop: (stopId) => {
      const poi = state.site.pois.find((p) => p.id === stopId);
      if (!poi) return;
      toast(`Your guide moved on to ${poi.name}.`);
      if (state.sensors.isDemo) walkDemoTo(poi);
    },
  });

  state.panoramaEl = document.querySelector("#demo-scene .panorama");
  bindControls();
  bindPowerSaving();
  state.running = true;
  requestAnimationFrame(frame);

  $("banner-title").textContent = state.site.name;
  $("banner-sub").textContent = state.sensors.isDemo
    ? "Demo tour — drag to look around"
    : "Looking for nearby monuments…";
  state.narrator.speak(`Welcome to ${state.site.name}. ${state.site.intro.split(". ")[0]}.`);
}

// A full-screen panel is over the AR view — there's nothing to see behind it,
// so skip the hotspot re-layout entirely until it closes.
function arCovered() {
  return !$("chat").hidden || !$("quiz").hidden || !$("group-dialog").hidden;
}

let renderCount = 0; // exposed for perf testing
function frame(now) {
  if (!state.running) return; // loop stopped (tab hidden)
  requestAnimationFrame(frame);

  // Throttle to the render interval — this is what keeps the loop from pinning
  // a core at 60 fps.
  if (now - state.lastRender < RENDER_INTERVAL_MS) return;
  const dt = now - state.lastFrame;
  state.lastFrame = now;
  state.lastRender = now;

  const s = state.sensors;
  s.tick?.(dt);
  if (arCovered() || !s.position) return;

  state.ar.render(state.site.pois, s.position, s.heading, s.pitch, state.members);
  updateBanner();
  if (s.isDemo) {
    const pan = `${(-(s.heading / 360) * 1800).toFixed(1)}px`;
    if (pan !== state.banner.pan) {
      state.panoramaEl?.style.setProperty("--pan", pan);
      state.banner.pan = pan;
    }
  }
  renderCount++;
  window.__vylarRenderCount = renderCount;
}

// Stop all per-frame work when the page isn't visible, and hush audio/camera
// so a backgrounded tab draws no power.
function bindPowerSaving() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.running = false;
      state.narrator.stopSpeaking();
      $("camera").pause?.();
    } else if (!state.running) {
      state.running = true;
      state.lastFrame = performance.now();
      $("camera").play?.().catch(() => {});
      requestAnimationFrame(frame);
    }
  });
}

function updateBanner() {
  const s = state.sensors;
  let nearest = null, nearestDist = Infinity;
  for (const poi of state.site.pois) {
    const d = distanceM(s.position, poi);
    if (d < nearestDist) { nearest = poi; nearestDist = d; }
  }
  if (!nearest) return;
  state.nearestPoi = nearestDist < 120 ? nearest : null;

  const tourPrefix = state.tour.active
    ? `Stop ${state.tour.index + 1}/${state.site.pois.length} · `
    : "";

  let title, sub;
  if (nearestDist < 80) {
    title = tourPrefix + nearest.name;
    sub = "You're here — tap the marker to explore";
    if (state.announcedPoi !== nearest.id) {
      state.announcedPoi = nearest.id;
      state.narrator.speak(`You've arrived at ${nearest.name}. ${nearest.short}`);
      state.hunt.maybeChallenge(nearest);
    }
  } else {
    const brg = bearingDeg(s.position, nearest);
    title = tourPrefix + state.site.name;
    sub = `Nearest: ${nearest.name} · ${formatDistance(nearestDist)} ${compassPoint(brg)}`;
  }

  // Only touch the DOM when the text actually changes.
  if (title !== state.banner.title) { $("banner-title").textContent = title; state.banner.title = title; }
  if (sub !== state.banner.sub) { $("banner-sub").textContent = sub; state.banner.sub = sub; }

  if (state.pastMode) updatePastCard(nearest, nearestDist);
}

/* ---------- Time travel (Phase 2) ---------- */
function updatePastCard(nearest, dist) {
  const text = dist < 400 && nearest.past
    ? nearest.past
    : "The young imperial city spreads along the river — temple spires, garden suburbs, and canals threading between the boulders.";
  if ($("past-text").textContent !== text) $("past-text").textContent = text;
}

function toggleTime() {
  state.pastMode = !state.pastMode;
  $("ar-view").classList.toggle("past", state.pastMode);
  $("btn-time").classList.toggle("active", state.pastMode);
  $("past-card").hidden = !state.pastMode;
  if (state.pastMode) {
    const text = state.nearestPoi?.past ||
      "You are looking at Vijayanagara at its height, around 1520 CE.";
    $("past-text").textContent = text;
    state.narrator.speak(`Travelling to the year 1520. ${text}`);
  } else {
    state.narrator.speak("Returning to the present day.");
  }
}

/* ---------- Guided tour (Phase 2) ---------- */
function toggleTour() {
  state.tour.active = !state.tour.active;
  $("btn-tour").classList.toggle("active", state.tour.active);
  if (state.tour.active) {
    state.tour.index = -1;
    $("btn-next").hidden = false;
    advanceTour();
  } else {
    $("btn-next").hidden = !state.sensors.isDemo;
    toast("Guided tour ended.");
  }
}

function advanceTour() {
  const pois = state.site.pois;
  state.tour.index = (state.tour.index + 1) % pois.length;
  const poi = pois[state.tour.index];
  state.announcedPoi = null;
  state.group?.push(poi.id); // leaders broadcast the stop to their room

  if (state.sensors.isDemo) {
    walkDemoTo(poi);
    toast(`Stop ${state.tour.index + 1} of ${pois.length}: walking to ${poi.name}…`);
  } else {
    const s = state.sensors;
    const dist = formatDistance(distanceM(s.position, poi));
    const dir = compassPoint(bearingDeg(s.position, poi));
    toast(`Stop ${state.tour.index + 1} of ${pois.length}: ${poi.name} — ${dist} ${dir}. Follow the marker.`);
    state.narrator.speak(`Next stop: ${poi.name}, ${dist} to the ${dir}.`);
  }
}

function walkDemoTo(poi) {
  const s = state.sensors;
  if (!s.isDemo) return;
  const idx = state.site.pois.findIndex((p) => p.id === poi.id);
  s._stopIndex = (idx - 1 + state.site.pois.length) % state.site.pois.length;
  s.nextStop();
  state.announcedPoi = null;
}

/* ---------- POI sheet ---------- */
function openSheet(poi) {
  $("sheet-title").textContent = poi.name;
  $("sheet-era").textContent = poi.era;
  $("sheet-narration").textContent = state.pastMode && poi.past ? poi.past : poi.narration;
  const facts = $("sheet-facts");
  facts.innerHTML = "";
  for (const f of poi.facts || []) {
    const li = document.createElement("li");
    li.textContent = f;
    facts.appendChild(li);
  }
  state.chat.renderButtons($("character-buttons"));
  $("ask-answer").hidden = true;
  $("ask-input").value = "";
  $("sheet").hidden = false;
  $("sheet").dataset.poiId = poi.id;
  state.narrator.speak(state.pastMode && poi.past ? poi.past : poi.narration);
  state.hunt.maybeChallenge(poi);
}

function bindControls() {
  $("sheet-close").addEventListener("click", () => {
    $("sheet").hidden = true;
    state.narrator.stopSpeaking();
  });

  $("btn-narrate").addEventListener("click", (e) => {
    const on = state.narrator.toggle();
    e.currentTarget.classList.toggle("off", !on);
    e.currentTarget.textContent = on ? "🔊" : "🔇";
  });

  $("btn-time").addEventListener("click", toggleTime);
  $("btn-tour").addEventListener("click", toggleTour);

  $("btn-next").addEventListener("click", () => {
    if (state.tour.active) {
      advanceTour();
    } else if (state.sensors.isDemo) {
      const poi = state.sensors.nextStop();
      state.announcedPoi = null;
      toast(`Walking to ${poi.name}…`);
    }
  });

  $("btn-identify").addEventListener("click", identify);

  $("ask-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("ask-input").value.trim();
    if (!q) return;
    const out = $("ask-answer");
    out.hidden = false;
    out.textContent = "Thinking…";
    try {
      const { answer, source, note } = await state.narrator.ask(q, $("sheet").dataset.poiId);
      out.innerHTML = "";
      out.append(answer);
      const src = document.createElement("span");
      src.className = "src";
      src.textContent = source === "ai" ? "— Vylar AI guide" : `— offline site pack${note ? ` (${note})` : ""}`;
      out.append(src);
      state.narrator.speak(answer);
    } catch (err) {
      out.textContent = `Couldn't reach the guide: ${err.message}`;
    }
  });
}

async function identify() {
  const video = $("camera");
  if (video.hidden || !video.videoWidth) {
    toast("The AI scanner needs the live camera. In demo mode, tap a golden marker instead.");
    return;
  }
  toast("Scanning…");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    const { result } = await state.narrator.identify(canvas.toDataURL("image/jpeg", 0.8));
    toast(result, 12000);
    state.narrator.speak(result);
  } catch (err) {
    toast(`Scan failed: ${err.message}`);
  }
}

let toastTimer = null;
function toast(msg, ms = 4000) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

init();
