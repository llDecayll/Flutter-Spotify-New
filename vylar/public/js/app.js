import { distanceM, bearingDeg, bearingDelta, formatDistance, compassPoint } from "./geo.js";
import { LiveSensors, DemoSensors } from "./sensors.js";
import { ARView } from "./ar.js";
import { Narrator } from "./narrator.js";

const $ = (id) => document.getElementById(id);

const state = {
  site: null,
  sensors: null,
  ar: null,
  narrator: new Narrator(),
  announcedPoi: null,
  lastFrame: performance.now(),
};

async function init() {
  state.site = await (await fetch("/data/hampi.json")).json();
  $("start-site-name").textContent = state.site.name;
  $("start-site-desc").textContent = state.site.intro.split(". ").slice(0, 2).join(". ") + ".";

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

  bindControls();
  requestAnimationFrame(frame);

  // Welcome narration
  $("banner-title").textContent = state.site.name;
  $("banner-sub").textContent = state.sensors.isDemo
    ? "Demo tour — drag to look around"
    : "Looking for nearby monuments…";
  state.narrator.speak(`Welcome to ${state.site.name}. ${state.site.intro.split(". ")[0]}.`);
}

function frame(now) {
  const dt = now - state.lastFrame;
  state.lastFrame = now;
  const s = state.sensors;
  s.tick?.(dt);

  if (s.position) {
    state.ar.render(state.site.pois, s.position, s.heading, s.pitch);
    updateBanner();
    if (s.isDemo) {
      document.querySelector("#demo-scene .panorama")
        ?.style.setProperty("--pan", `${-(s.heading / 360) * 1800}px`);
    }
  }
  requestAnimationFrame(frame);
}

function updateBanner() {
  const s = state.sensors;
  let nearest = null, nearestDist = Infinity;
  for (const poi of state.site.pois) {
    const d = distanceM(s.position, poi);
    if (d < nearestDist) { nearest = poi; nearestDist = d; }
  }
  if (!nearest) return;

  if (nearestDist < 80) {
    $("banner-title").textContent = nearest.name;
    $("banner-sub").textContent = "You're here — tap the marker to explore";
    if (state.announcedPoi !== nearest.id) {
      state.announcedPoi = nearest.id;
      state.narrator.speak(`You've arrived at ${nearest.name}. ${nearest.short}`);
    }
  } else {
    const brg = bearingDeg(s.position, nearest);
    $("banner-title").textContent = state.site.name;
    $("banner-sub").textContent =
      `Nearest: ${nearest.name} · ${formatDistance(nearestDist)} ${compassPoint(brg)}`;
  }
}

function openSheet(poi) {
  $("sheet-title").textContent = poi.name;
  $("sheet-era").textContent = poi.era;
  $("sheet-narration").textContent = poi.narration;
  const facts = $("sheet-facts");
  facts.innerHTML = "";
  for (const f of poi.facts || []) {
    const li = document.createElement("li");
    li.textContent = f;
    facts.appendChild(li);
  }
  $("ask-answer").hidden = true;
  $("ask-input").value = "";
  $("sheet").hidden = false;
  $("sheet").dataset.poiId = poi.id;
  state.narrator.speak(poi.narration);
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

  $("btn-next").addEventListener("click", () => {
    const poi = state.sensors.nextStop();
    state.announcedPoi = null;
    toast(`Walking to ${poi.name}…`);
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
