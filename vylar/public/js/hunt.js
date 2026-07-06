// Phase 3: treasure hunt / classroom mode. Arrive at a monument, answer its
// relic challenge, collect the set. Progress persists in localStorage.
const $ = (id) => document.getElementById(id);
const STORE_KEY = "vylar-hunt";

export class TreasureHunt {
  constructor(site, toast, narrator) {
    this.site = site;
    this.toast = toast;
    this.narrator = narrator;
    this.active = false;
    this.found = new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]"));
    this._askedThisSession = new Set();
    $("btn-hunt").addEventListener("click", () => this.toggle());
  }

  toggle() {
    this.active = !this.active;
    $("btn-hunt").classList.toggle("active", this.active);
    if (this.active) {
      this.toast(this.progressText() + " Visit a monument and answer its relic challenge.");
      this.narrator.speak("Treasure hunt started. " + this.progressText());
    } else {
      this.toast("Treasure hunt paused.");
    }
    return this.active;
  }

  progressText() {
    return `Relics: ${this.found.size} of ${this.site.pois.length}.`;
  }

  // Called when the visitor arrives at (or opens) a POI.
  maybeChallenge(poi) {
    if (!this.active || !poi.quiz) return false;
    if (this.found.has(poi.id) || this._askedThisSession.has(poi.id)) return false;
    this._askedThisSession.add(poi.id);
    this._show(poi);
    return true;
  }

  _show(poi) {
    const quiz = poi.quiz;
    $("quiz-question").textContent = quiz.question;
    $("quiz-result").hidden = true;
    const box = $("quiz-options");
    box.innerHTML = "";
    quiz.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt;
      btn.addEventListener("click", () => this._answer(poi, i, btn, box));
      box.appendChild(btn);
    });
    $("quiz").hidden = false;
  }

  _answer(poi, i, btn, box) {
    const correct = i === poi.quiz.answer;
    for (const b of box.children) b.disabled = true;
    btn.classList.add(correct ? "correct" : "wrong");
    const result = $("quiz-result");
    result.hidden = false;
    if (correct) {
      this.found.add(poi.id);
      localStorage.setItem(STORE_KEY, JSON.stringify([...this.found]));
      const done = this.found.size === this.site.pois.length;
      result.textContent = done
        ? `🏆 Relic collected! You've found all ${this.site.pois.length} relics of ${this.site.name}!`
        : `🏺 Relic collected! ${this.progressText()}`;
      this.narrator.speak(result.textContent.replace(/[🏺🏆]/g, ""));
    } else {
      box.children[poi.quiz.answer].classList.add("correct");
      result.textContent = "Not quite — the highlighted answer is correct. This relic stays hidden for now.";
      this._askedThisSession.delete(poi.id); // allow retry on next visit
    }
    setTimeout(() => ($("quiz").hidden = true), correct ? 2800 : 3600);
  }
}
