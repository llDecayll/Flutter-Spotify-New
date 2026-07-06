// Phase 3: shared group tours. SSE roster stream + periodic position updates.
const $ = (id) => document.getElementById(id);

export class GroupTour {
  constructor({ getPosition, onRoster, onLeaderStop, toast }) {
    this.getPosition = getPosition;
    this.onRoster = onRoster;
    this.onLeaderStop = onLeaderStop;
    this.toast = toast;
    this.code = null;
    this.memberId = null;
    this.leader = false;
    this._lastStopId = null;
    this._stream = null;
    this._pushTimer = null;
    this._bindUi();
  }

  _bindUi() {
    $("btn-group").addEventListener("click", () => {
      $("group-dialog").hidden = false;
    });
    $("group-close").addEventListener("click", () => ($("group-dialog").hidden = true));
    $("group-create").addEventListener("click", async () => {
      const res = await fetch("/api/rooms", { method: "POST" });
      const { code } = await res.json();
      await this.join(code);
    });
    $("group-join").addEventListener("click", () =>
      this.join($("group-code").value.trim().toUpperCase()),
    );
    $("group-leave").addEventListener("click", () => this.leave());
  }

  async join(code) {
    if (!code) return;
    const name = $("group-name").value.trim() || "Explorer";
    const pos = this.getPosition() || {};
    const res = await fetch(`/api/rooms/${code}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, lat: pos.lat, lng: pos.lng }),
    });
    if (!res.ok) {
      this.toast(`Room ${code} not found.`);
      return;
    }
    const data = await res.json();
    this.code = code;
    this.memberId = data.memberId;
    this.leader = data.leader;
    this.name = name;

    $("group-status").hidden = false;
    $("group-code-label").textContent = code;
    $("group-dialog").hidden = true;
    $("btn-group").classList.add("active");
    this.toast(
      this.leader
        ? `Room ${code} created — you're leading. Share the code!`
        : `Joined room ${code}.`,
    );

    this._stream = new EventSource(`/api/rooms/${code}/stream`);
    this._stream.onmessage = (e) => this._onSnapshot(JSON.parse(e.data));
    this._pushTimer = setInterval(() => this.push(), 4000);
  }

  _onSnapshot(snap) {
    $("group-count").textContent = `${snap.members.length} explorer${snap.members.length === 1 ? "" : "s"}`;
    this.onRoster(snap.members.filter((m) => m.id !== this.memberId && m.lat != null));
    if (!this.leader && snap.tourStopId && snap.tourStopId !== this._lastStopId) {
      this._lastStopId = snap.tourStopId;
      this.onLeaderStop(snap.tourStopId);
    }
  }

  push(tourStopId) {
    if (!this.code) return;
    const pos = this.getPosition() || {};
    fetch(`/api/rooms/${this.code}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberId: this.memberId,
        name: this.name,
        lat: pos.lat,
        lng: pos.lng,
        ...(this.leader && tourStopId !== undefined ? { tourStopId } : {}),
      }),
    }).catch(() => {});
  }

  leave() {
    this._stream?.close();
    clearInterval(this._pushTimer);
    this.code = null;
    this.memberId = null;
    this.leader = false;
    $("group-status").hidden = true;
    $("group-dialog").hidden = true;
    $("btn-group").classList.remove("active");
    this.onRoster([]);
  }
}
