// Voice narration (Web Speech API) + AI Q&A against the server.
export class Narrator {
  constructor() {
    this.enabled = true;
  }

  speak(text) {
    if (!this.enabled || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.98;
    u.pitch = 1.0;
    const voice = speechSynthesis
      .getVoices()
      .find((v) => v.lang.startsWith("en") && /Google|Natural|Premium/i.test(v.name));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }

  stopSpeaking() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopSpeaking();
    return this.enabled;
  }

  async ask(question, poiId) {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, poiId }),
    });
    if (!res.ok) throw new Error(`ask failed: ${res.status}`);
    return res.json();
  }

  async identify(dataUrl) {
    const res = await fetch("/api/identify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!res.ok) throw new Error(`identify failed: ${res.status}`);
    return res.json();
  }
}
