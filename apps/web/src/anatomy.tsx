// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// 3D anatomy viewer (MVP).
//
// Design rules that matter for a hospital app on a Bangladeshi mobile connection:
//   * three.js is downloaded ONLY when the patient taps "Open 3D view" (lazy import),
//     so the normal app stays small and fast.
//   * on mobile data it asks first — the "3D on Wi-Fi only" switch is on by default.
//   * if WebGL is unavailable or the download fails, a 2D picture of the same organ is
//     shown instead; the feature never breaks the page.
//   * the models are built from simple geometry (no large glTF download) and are teaching
//     illustrations, not diagnostic images — the caption says so.
import { useEffect, useRef, useState } from "react";

type Organ = "heart" | "lungs" | "brain";

const ORGANS: { id: Organ; name: string; caption: string }[] = [
  { id: "heart", name: "Heart", caption: "Four chambers pump blood through the lungs and the body. The coronary arteries sit on the surface." },
  { id: "lungs", name: "Lungs", caption: "Air travels down the trachea into two lungs, where oxygen crosses into the blood." },
  { id: "brain", name: "Brain", caption: "The brain is divided into two hemispheres, each with four lobes." },
];

const WIFI_KEY = "medai_3d_wifi_only";

const wifiOnly = (): boolean => {
  try { return localStorage.getItem(WIFI_KEY) !== "0"; } catch { return true; }
};
const setWifiOnly = (on: boolean) => {
  try { on ? localStorage.removeItem(WIFI_KEY) : localStorage.setItem(WIFI_KEY, "0"); } catch { /* ignore */ }
};

/** True when the phone is on a slow or metered connection. */
function looksMetered(): boolean {
  try {
    const c: any = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!c) return false;
    if (c.type === "cellular") return true;
    return ["slow-2g", "2g", "3g"].includes(String(c.effectiveType || ""));
  } catch { return false; }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch { return false; }
}

/** Simple shapes are enough to explain the organ, and they download instantly. */
async function buildScene(container: HTMLDivElement, organ: Organ, onFrame: (t: number) => void) {
  const THREE = await import("three");
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 280;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 7);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7ea8ff, 0.5);
  rim.position.set(-4, -2, -3);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const material = (color: number, opacity = 1) => new THREE.MeshStandardMaterial({
    color, roughness: 0.45, metalness: 0.08, transparent: opacity < 1, opacity,
  });

  if (organ === "heart") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.45, 48, 32), material(0xc0392b));
    body.scale.set(1, 1.18, 0.92);
    group.add(body);
    const atrium = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 24), material(0xd9534f));
    atrium.position.set(-0.62, 0.95, 0.25);
    group.add(atrium);
    const aorta = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 20, 40, Math.PI * 1.5), material(0xe0675f));
    aorta.position.set(0.85, 0.9, 0);
    aorta.rotation.z = -0.5;
    group.add(aorta);
    const artery = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 1.5, 20), material(0xa93226));
    artery.position.set(0.35, 1.75, 0);
    artery.rotation.z = 0.25;
    group.add(artery);
  } else if (organ === "lungs") {
    const lungMat = material(0xe98ba0, 0.92);
    const left = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), lungMat);
    left.scale.set(0.85, 1.5, 0.8);
    left.position.set(-1.05, -0.15, 0);
    group.add(left);
    const right = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), lungMat);
    right.scale.set(0.85, 1.5, 0.8);
    right.position.set(1.05, -0.15, 0);
    group.add(right);
    const trachea = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 20), material(0xb7d4e6));
    trachea.position.set(0, 1.55, 0);
    group.add(trachea);
    for (const x of [-0.55, 0.55]) {
      const bronchus = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 16), material(0xb7d4e6));
      bronchus.position.set(x * 0.75, 0.75, 0);
      bronchus.rotation.z = x > 0 ? -0.6 : 0.6;
      group.add(bronchus);
    }
  } else {
    const brainMat = material(0xf0a9b8);
    for (const x of [-0.85, 0.85]) {
      const hemi = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 32), brainMat);
      hemi.scale.set(1, 0.92, 1.15);
      hemi.position.set(x, 0.1, 0);
      group.add(hemi);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.4, 20), material(0xe4a3ae));
    stem.position.set(0, -1.35, 0);
    group.add(stem);
    const cortex = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.3, 2),
      new THREE.MeshStandardMaterial({ color: 0xf7c1cc, wireframe: true, transparent: true, opacity: 0.5 }),
    );
    cortex.position.set(-0.85, 0.1, 0);
    group.add(cortex);
  }

  let frame = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let velocity = 0.004;
  let rotationX = 0;

  const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    velocity = dx * 0.0006;
    group.rotation.y += dx * 0.01;
    rotationX = Math.max(-0.7, Math.min(0.7, rotationX + dy * 0.006));
    group.rotation.x = rotationX;
  };
  const up = () => { dragging = false; };
  renderer.domElement.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);

  const animate = () => {
    frame = requestAnimationFrame(animate);
    if (!dragging) {
      group.rotation.y += velocity;
      velocity += (0.004 - velocity) * 0.02;         // drift back to a slow spin
    }
    onFrame(frame);
    renderer.render(scene, camera);
  };
  animate();

  return () => {
    cancelAnimationFrame(frame);
    renderer.domElement.removeEventListener("pointerdown", down);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    scene.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };
}

export function AnatomyCard() {
  const [organ, setOrgan] = useState<Organ>("heart");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error" | "ask">("idle");
  const [note, setNote] = useState("");
  const [wifi, setWifiState] = useState(() => wifiOnly());
  const container = useRef<HTMLDivElement | null>(null);
  const cleanup = useRef<null | (() => void)>(null);

  const current = ORGANS.find((o) => o.id === organ)!;

  function teardown() {
    cleanup.current?.();
    cleanup.current = null;
  }

  async function start(force = false) {
    if (!force && wifi && looksMetered()) { setStatus("ask"); return; }
    if (!webglAvailable()) { setStatus("error"); setNote("This device cannot show 3D (WebGL is off). The picture below shows the same organ."); return; }
    setStatus("loading");
    setNote("");
    try {
      await new Promise((r) => setTimeout(r, 30));       // let the spinner paint first
      if (!container.current) return;
      cleanup.current = await buildScene(container.current, organ, () => {});
      setStatus("ready");
    } catch (e: any) {
      setStatus("error");
      setNote("Could not load the 3D view (" + (e?.message || "network") + "). The picture below shows the same organ.");
    }
  }

  // Rebuild the model when the organ changes while open.
  useEffect(() => {
    if (!open) { teardown(); return; }
    teardown();
    setStatus("idle");
    start();
    return () => teardown();
  }, [open, organ]);

  function close() {
    teardown();
    setOpen(false);
    setStatus("idle");
  }

  return (
    <article className="anatomy">
      <div className="anatomy-head">
        <div>
          <h3>3D anatomy</h3>
          <p className="muted small">Look at a heart, lungs or brain from every side. Pictures for learning only — not for diagnosis.</p>
        </div>
        {!open
          ? <button className="primary" onClick={() => setOpen(true)}>Open 3D view</button>
          : <button className="outline" onClick={close}>Close</button>}
      </div>

      {open && (
        <>
          <div className="anatomy-tabs" role="tablist">
            {ORGANS.map((o) => (
              <button key={o.id} role="tab" aria-selected={o.id === organ}
                className={o.id === organ ? "active" : ""} onClick={() => setOrgan(o.id)}>{o.name}</button>
            ))}
          </div>

          <div className="anatomy-stage">
            <div ref={container} className="anatomy-canvas" aria-label={`3D model of the ${current.name.toLowerCase()}`} />

            {status !== "ready" && (
              <div className="anatomy-fallback">
                {status === "loading" && <><span className="spinner" aria-hidden="true" /><b>Loading the 3D model…</b><p>The first time can take a few seconds.</p></>}
                {status === "ask" && <>
                  <b>You are on mobile data</b>
                  <p>The 3D model is about 600 KB. Load it now, or wait until you are on Wi-Fi.</p>
                  <div className="row">
                    <button className="primary" onClick={() => start(true)}>Load anyway</button>
                    <button className="outline" onClick={close}>Not now</button>
                  </div>
                </>}
                {status === "error" && <><span aria-hidden="true">🫀</span><b>{current.name}</b><p>{note}</p></>}
                {status === "idle" && <><span aria-hidden="true">🫀</span><b>{current.name}</b><p>{current.caption}</p></>}
              </div>
            )}
          </div>

          <p className="anatomy-caption">{current.caption} <span className="muted">Drag the model to turn it.</span></p>

          <label className="check anatomy-pref">
            <input type="checkbox" checked={wifi} onChange={(e) => { setWifiState(e.target.checked); setWifiOnly(e.target.checked); }} />
            Ask before loading 3D on mobile data
          </label>
        </>
      )}
    </article>
  );
}
