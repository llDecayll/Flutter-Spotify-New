// Time Machine: a world-anchored 3D reconstruction you look around by moving
// the phone, and scrub through time. Rendered with Three.js.
//
// Honesty notes (see docs/TIMEMACHINE.md):
// - This is 3DoF: the monument is anchored and you rotate to look around it.
//   True 6DoF walk-around anchoring ("locations cannot be moved" as you walk)
//   needs native ARKit/ARCore + VPS and is not achievable in a mobile browser.
// - The Taj Mahal here is a PROCEDURAL STAND-IN built from primitives, not a
//   real photogrammetry scan. Uploaded monuments carry a glTF modelUrl per era;
//   loading real scanned meshes is the same code path with a GLTFLoader.
import * as THREE from "/vendor/three.module.js";

export class TimeMachine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
    this.camera.rotation.order = "YXZ";
    // Camera is fixed at a viewpoint; the monument stays put. You rotate to look.
    this.camera.position.set(0, 6, 78);
    this.yaw = 0;
    this.pitch = 0;
    this.needsRender = true;
    this.running = false;
    this.monumentGroup = null;
    this._buildStaticWorld();
    this._resize();
    window.addEventListener("resize", () => { this._resize(); this.needsRender = true; });
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildStaticWorld() {
    const s = this.scene;
    s.background = new THREE.Color(0x9fc0e8);
    s.fog = new THREE.Fog(0x9fc0e8, 220, 900);
    s.add(new THREE.HemisphereLight(0xffffff, 0x66502f, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2df, 1.15);
    sun.position.set(60, 120, 40);
    s.add(sun);

    // Ground + river (the place itself — always present, even when the
    // monument is not, so "1000 CE: empty riverbank" reads as an open place).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x6f7d43 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    s.add(ground);
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 120),
      new THREE.MeshStandardMaterial({ color: 0x3a6b8a }),
    );
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -0.1, -120);
    s.add(river);
  }

  // --- Procedural Taj Mahal, assembled so eras can show/hide parts. ---
  _tajMahal(state) {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.8 });
    const sandstone = new THREE.MeshStandardMaterial({ color: 0xb07a4f, roughness: 0.9 });
    const scaffold = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 1 });
    const complete = state === "complete";
    const mat = complete ? white : sandstone;

    const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    const cyl = (r1, r2, h, m, x, y, z, seg = 16) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };

    // Plinth (built in every present-monument era)
    box(60, 3, 60, mat, 0, 1.5, 0);

    // Main building cube
    const cubeH = complete ? 22 : 14; // shorter while under construction
    box(34, cubeH, 34, mat, 0, 3 + cubeH / 2, 0);

    // Central dome (drum + onion dome + finial) — only meaningful when built
    const drumY = 3 + cubeH;
    cyl(9, 9, 6, mat, 0, drumY + 3, 0, 24);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(11, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
      complete ? white : scaffold,
    );
    dome.position.set(0, drumY + 6, 0);
    if (!complete) dome.material.wireframe = true; // scaffolded dome under construction
    g.add(dome);
    if (complete) cyl(0.5, 0.5, 5, white, 0, drumY + 6 + 9, 0, 8); // finial spire

    // Four minarets at the platform corners
    const minH = complete ? 40 : 18;
    for (const [mx, mz] of [[26, 26], [-26, 26], [26, -26], [-26, -26]]) {
      cyl(1.6, 2, minH, mat, mx, 3 + minH / 2, mz, 14);
      if (complete) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
        cap.position.set(mx, 3 + minH, mz);
        g.add(cap);
      }
    }

    // Construction scaffolding poles around the cube
    if (state === "construction") {
      for (const [sx, sz] of [[19, 19], [-19, 19], [19, -19], [-19, -19]]) {
        cyl(0.4, 0.4, cubeH + 8, scaffold, sx, 3 + (cubeH + 8) / 2, sz, 6);
      }
    }
    return g;
  }

  setEra(era) {
    if (this.monumentGroup) { this.scene.remove(this.monumentGroup); this._dispose(this.monumentGroup); }
    this.monumentGroup = era.state === "absent" ? null : this._tajMahal(era.state);
    if (this.monumentGroup) this.scene.add(this.monumentGroup);
    // Sky shifts by era for a felt sense of time.
    const sky = era.state === "absent" ? 0xbcd3ea : era.state === "construction" ? 0xcbb890 : 0x9fc0e8;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog.color = new THREE.Color(sky);
    this.needsRender = true;
  }

  _dispose(group) {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  look(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = Math.max(-1.2, Math.min(1.2, pitch));
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.needsRender = true;
  }

  start() {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (!this.needsRender) return; // render-on-demand: idle GPU when still
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  hasMonument() { return !!this.monumentGroup; }
}
