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
