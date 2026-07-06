// Vylar Phase 1 server — static app + AI endpoints (narration Q&A, landmark ID).
// Runs with no configuration; if no Anthropic credentials are available the AI
// endpoints degrade to offline answers drawn from the site pack.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 8787;
const MODEL = process.env.VYLAR_MODEL || "claude-opus-4-8";

const site = JSON.parse(
  await readFile(path.join(PUBLIC_DIR, "data", "hampi.json"), "utf8"),
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let client = null;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function poiContext(poi) {
  if (!poi) return site.intro;
  const facts = (poi.facts || []).map((f) => `- ${f}`).join("\n");
  return `${site.intro}\n\nThe visitor is at: ${poi.name} (${poi.era}).\n${poi.narration}\nKey facts:\n${facts}`;
}

// Offline fallback: keyword-overlap search across the site pack's Q&A entries.
function offlineAnswer(question, poi) {
  const words = question.toLowerCase().match(/[a-z]+/g) || [];
  let best = null;
  let bestScore = 0;
  const pois = poi ? [poi, ...site.pois.filter((p) => p !== poi)] : site.pois;
  for (const p of pois) {
    for (const qa of p.qa || []) {
      const score = qa.q.filter((k) => words.includes(k)).length;
      if (score > bestScore) {
        bestScore = score;
        best = qa.a;
      }
    }
  }
  if (best) return best;
  if (poi) return `${poi.short} ${poi.narration.split(". ").slice(0, 2).join(". ")}.`;
  return site.intro;
}

async function handleAsk(req, res) {
  const body = JSON.parse((await readBody(req)).toString("utf8"));
  const question = String(body.question || "").slice(0, 500).trim();
  const poi = site.pois.find((p) => p.id === body.poiId) || null;
  if (!question) return json(res, 400, { error: "question required" });

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        `You are Vylar, an expert heritage guide accompanying a visitor at ${site.name}. ` +
        "Answer from the site notes provided; you may add well-established history of the Vijayanagara Empire. " +
        "Be warm and vivid but under 120 words. If something is uncertain or debated by historians, say so plainly. " +
        "Clearly label myth or legend as such. If the question is unrelated to the site, answer in one sentence and steer back.",
      messages: [
        {
          role: "user",
          content: `Site notes:\n${poiContext(poi)}\n\nVisitor's question: ${question}`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return json(res, 200, { answer: text, source: "ai" });
  } catch (err) {
    return json(res, 200, {
      answer: offlineAnswer(question, poi),
      source: "offline",
      note: "AI narrator unavailable — answered from the offline site pack.",
    });
  }
}

async function handleCharacter(req, res) {
  const body = JSON.parse((await readBody(req)).toString("utf8"));
  const character = site.characters.find((c) => c.id === body.characterId);
  if (!character) return json(res, 400, { error: "unknown character" });
  const message = String(body.message || "").slice(0, 500).trim();
  if (!message) return json(res, 400, { error: "message required" });
  const poi = site.pois.find((p) => p.id === body.poiId) || null;
  // Client passes recent turns so the server stays stateless.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-8)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        `You are roleplaying ${character.name} (${character.role}) speaking with a modern visitor at ${site.name}. ` +
        `Persona: ${character.persona} ` +
        (character.fictional
          ? "You are an openly fictional composite character; if asked whether you were a real person, say so honestly. "
          : "Stay within what this historical figure could plausibly know for their era; do not invent specific facts. ") +
        "Ground everything in the site notes and well-established history of Vijayanagara; if something is uncertain or legendary, say so in character. " +
        "You are an AI portrayal — acknowledge this plainly if the visitor asks. Stay in character otherwise. Keep replies under 100 words.",
      messages: [
        ...history,
        {
          role: "user",
          content: `Site notes:\n${poiContext(poi)}\n\nVisitor says: ${message}`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return json(res, 200, { reply: text, source: "ai" });
  } catch (err) {
    return json(res, 200, { reply: character.offline, source: "offline" });
  }
}

// ---- Shared tour rooms (Phase 3): in-memory presence + leader stop sync ----
const rooms = new Map(); // code -> { members: Map, streams: Set, tourStopId, createdAt }
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

function makeRoom() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)],
    ).join("");
  } while (rooms.has(code));
  const room = { code, members: new Map(), streams: new Set(), tourStopId: null, createdAt: Date.now() };
  rooms.set(code, room);
  return room;
}

function roomSnapshot(room) {
  return {
    code: room.code,
    tourStopId: room.tourStopId,
    members: [...room.members.values()].map(({ id, name, lat, lng, leader }) => ({ id, name, lat, lng, leader })),
  };
}

function broadcast(room) {
  const data = `data: ${JSON.stringify(roomSnapshot(room))}\n\n`;
  for (const stream of room.streams) stream.write(data);
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const [id, m] of room.members) if (now - m.lastSeen > 60000) room.members.delete(id);
    if (now - room.createdAt > ROOM_TTL_MS || (room.members.size === 0 && room.streams.size === 0)) {
      for (const s of room.streams) s.end();
      rooms.delete(code);
    }
  }
}, 30000).unref();

async function handleRoom(req, res, pathname) {
  // POST /api/rooms                    -> create room
  // POST /api/rooms/:code/update       -> join/update member (and leader's tour stop)
  // GET  /api/rooms/:code/stream       -> SSE roster updates
  const parts = pathname.split("/").filter(Boolean); // [api, rooms, code?, action?]
  if (req.method === "POST" && parts.length === 2) {
    const room = makeRoom();
    return json(res, 200, { code: room.code });
  }
  const room = rooms.get((parts[2] || "").toUpperCase());
  if (!room) return json(res, 404, { error: "room not found" });

  if (req.method === "GET" && parts[3] === "stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(roomSnapshot(room))}\n\n`);
    room.streams.add(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      room.streams.delete(res);
    });
    return;
  }

  if (req.method === "POST" && parts[3] === "update") {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const id = String(body.memberId || "").slice(0, 40) || Math.random().toString(36).slice(2, 10);
    const isFirst = room.members.size === 0;
    const existing = room.members.get(id);
    room.members.set(id, {
      id,
      name: String(body.name || "Explorer").slice(0, 24),
      lat: Number(body.lat) || null,
      lng: Number(body.lng) || null,
      leader: existing ? existing.leader : isFirst,
      lastSeen: Date.now(),
    });
    if (room.members.get(id).leader && body.tourStopId !== undefined) {
      room.tourStopId = body.tourStopId;
    }
    broadcast(room);
    return json(res, 200, { memberId: id, leader: room.members.get(id).leader });
  }

  return json(res, 405, { error: "unsupported" });
}

async function handleIdentify(req, res) {
  const body = JSON.parse((await readBody(req)).toString("utf8"));
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.image || "");
  if (!match) return json(res, 400, { error: "image must be a base64 data URL" });

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: match[1], data: match[2] },
            },
            {
              type: "text",
              text:
                `The visitor is somewhere in or near ${site.name}. Identify the monument, structure, or artifact in this photo. ` +
                "Name it if you can, then give 2-3 sentences of historical context. If you cannot identify it confidently, say so and describe what you can see.",
            },
          ],
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return json(res, 200, { result: text, source: "ai" });
  } catch (err) {
    return json(res, 200, {
      result:
        "The AI scanner is unavailable right now. Point the camera at a marked hotspot instead — the offline site pack covers the major monuments.",
      source: "offline",
    });
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && pathname === "/api/ask") return await handleAsk(req, res);
    if (req.method === "POST" && pathname === "/api/identify") return await handleIdentify(req, res);
    if (req.method === "POST" && pathname === "/api/character") return await handleCharacter(req, res);
    if (pathname.startsWith("/api/rooms")) return await handleRoom(req, res, pathname);
    if (req.method === "GET") return serveStatic(req, res, pathname);
    res.writeHead(405).end();
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Vylar running at http://localhost:${PORT}`);
  console.log(`AI narrator model: ${MODEL} (offline fallback active if no credentials)`);
});
