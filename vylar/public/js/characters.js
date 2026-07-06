// Phase 2: conversational historical characters.
// Client keeps the short chat history and passes it to the stateless server.
const $ = (id) => document.getElementById(id);

export class CharacterChat {
  constructor(site, narrator, getPoiId) {
    this.site = site;
    this.narrator = narrator;
    this.getPoiId = getPoiId;
    this.character = null;
    this.history = [];
    $("chat-close").addEventListener("click", () => this.close());
    $("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.send($("chat-input").value.trim());
    });
  }

  renderButtons(container) {
    container.innerHTML = "";
    for (const c of this.site.characters || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = c.name;
      btn.addEventListener("click", () => this.open(c));
      container.appendChild(btn);
    }
  }

  open(character) {
    this.character = character;
    this.history = [];
    $("chat-name").textContent = character.name;
    $("chat-role").textContent =
      character.role + (character.fictional ? " · fictional composite" : "") + " · AI portrayal";
    $("chat-messages").innerHTML = "";
    $("chat").hidden = false;
    this._bubble("them", character.greeting);
    this.narrator.speak(character.greeting);
    $("chat-input").focus();
  }

  close() {
    $("chat").hidden = true;
    this.narrator.stopSpeaking();
  }

  async send(text) {
    if (!text || !this.character) return;
    $("chat-input").value = "";
    this._bubble("user", text);
    const pending = this._bubble("them", "…");
    try {
      const res = await fetch("/api/character", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          characterId: this.character.id,
          message: text,
          poiId: this.getPoiId(),
          history: this.history,
        }),
      });
      const { reply, source } = await res.json();
      pending.textContent = reply;
      const src = document.createElement("span");
      src.className = "src";
      src.textContent = source === "ai" ? "AI portrayal" : "offline";
      pending.appendChild(src);
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      this.history = this.history.slice(-8);
      this.narrator.speak(reply);
    } catch (err) {
      pending.textContent = `The ${this.character.name} portrayal is unreachable: ${err.message}`;
    }
    $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
  }

  _bubble(kind, text) {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.textContent = text;
    $("chat-messages").appendChild(el);
    $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    return el;
  }
}
