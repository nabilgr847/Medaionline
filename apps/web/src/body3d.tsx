// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Interactive full-body 3D anatomy map: the patient rotates/zooms a real skeleton +
// organ model, taps the exact place that hurts, and sends that spot to one chosen doctor.
//
// Source model: BodyParts3D 4.0 (Database Center for Life Science, Japan) — CC BY 4.0.
// It was simplified and re-packed by scripts/anatomy/build-anatomy-model.mjs; the
// attribution is shown in the UI and in public/anatomy/ATTRIBUTION.md.
//
// Rules baked into this screen:
//   * nothing is downloaded until the patient opens the map (three.js + a 4 MB model);
//   * muscles and blood vessels are separate ~1 MB files, fetched only when switched on;
//   * a metered connection asks first (same preference as the 3D anatomy tab);
//   * this is a way to reach a doctor, not a diagnosis — the copy says so plainly;
//   * emergencies never wait for a doctor reply: call 999.
import { useEffect, useRef, useState } from "react";
import { Api, json, fmtDate } from "./api";
import { DoctorPicker } from "./extras";
import { wifiOnly, setWifiOnly, looksMetered, webglAvailable } from "./anatomy";

const MODEL_URL = "anatomy/body.glb";
const PARTS_URL = "anatomy/body.parts.json";

/** Optional overlay layers: real BodyParts3D data, downloaded on demand. */
const EXTRA_LAYERS = [
  { id: "muscles", file: "anatomy/muscles.glb", label: "Muscles", size: "1.2 MB", opacity: 0.34 },
  { id: "vessels", file: "anatomy/vessels.glb", label: "Blood vessels", size: "0.9 MB", opacity: 1 },
] as const;
type ExtraLayer = "muscles" | "vessels";

type BodyPart = { id: number; name: string; system: string; layer?: string };
type Layers = Record<string, boolean>;

const SYSTEM_LABEL: Record<string, string> = {
  skeletal: "Bones",
  cardiac: "Heart",
  respiratory: "Lungs",
  digestive: "Digestive",
  urinary: "Kidneys / urinary",
  endocrine: "Glands",
  reproductive: "Reproductive",
  sensory: "Senses",
  nervous: "Brain / nerves",
};

const SINCE_OPTIONS: [string, string][] = [
  ["0", "Today"],
  ["2", "2–3 days"],
  ["7", "About a week"],
  ["30", "2–4 weeks"],
  ["90", "Longer than a month"],
];

/** three.js lowercases custom attributes: the GLB's `_PARTID` is exposed as `_partid`. */
function partIds(mesh: any): any {
  const attributes = mesh?.geometry?.attributes;
  return attributes ? attributes._partid || attributes._PARTID : null;
}

type Handles = {
  dispose: () => void;
  reset: () => void;
  nudge: (direction: number) => void;
  zoomBy: (factor: number) => void;
  applyLayers: (layers: Layers) => void;
  /** Downloads and attaches an optional layer. Returns how many new meshes were added. */
  loadLayer: (layer: ExtraLayer) => Promise<number>;
  setExtraVisible: (layer: ExtraLayer, visible: boolean) => void;
};

/** Builds the three.js scene. Three.js is imported here so it stays out of the main bundle. */
async function buildBody(
  host: HTMLDivElement,
  onPick: (partId: number, name: string) => void,
  onProgress: (fraction: number) => void,
): Promise<{ handles: Handles; parts: BodyPart[]; modelBytes: number }> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

  const manifest = await (await fetch(PARTS_URL, { cache: "force-cache" })).json();
  const parts = (manifest.parts || []) as BodyPart[];
  const byId = new Map<number, BodyPart>(parts.map((p) => [p.id, p]));

  const width = host.clientWidth || 320;
  const height = host.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "3D body model. Drag to rotate, pinch or scroll to zoom, tap the place that hurts.");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.02, 40);
  const HOME = { z: 3.15, y: 0 };
  camera.position.set(0, HOME.y, HOME.z);

  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9dc0ff, 0.7);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  // Model is authored in metres with the feet at y = 0; lift it so the middle is at the origin.
  const group = new THREE.Group();
  group.position.y = -0.92;
  scene.add(group);

  const loader = new GLTFLoader();
  let modelBytes = 0;
  const gltf: any = await new Promise((resolve, reject) => {
    loader.load(
      MODEL_URL,
      (g: any) => resolve(g),
      (event: ProgressEvent) => {
        if (event.total) { modelBytes = event.total; onProgress(Math.min(1, event.loaded / event.total)); }
        else if (event.loaded) { modelBytes = event.loaded; onProgress(0.5); }
      },
      () => reject(new Error("The 3D body model could not be downloaded.")),
    );
  });

  const pickables: any[] = [];
  const attach = (node: any, layer: string) => {
    // The files carry no normals (they cost ~1 MB); smooth them once on the device.
    if (!node.geometry.attributes.normal) node.geometry.computeVertexNormals();
    node.userData.system = node.name.replace(/-\d+$/, "");
    node.userData.layer = layer;
    node.frustumCulled = true;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (material) {
      material.roughness = node.userData.system === "skeletal" ? 0.95 : 0.6;
      material.metalness = 0;
      material.side = THREE.DoubleSide;
      if (layer === "muscles") {
        // See-through so the bones and organs stay visible inside the body.
        material.transparent = true;
        material.opacity = EXTRA_LAYERS.find((entry) => entry.id === "muscles")!.opacity;
        material.depthWrite = false;
      }
    }
    pickables.push(node);
    group.add(node);
  };
  gltf.scene.traverse((node: any) => { if (node.isMesh) attach(node, "body"); });

  const loadedExtras = new Set<ExtraLayer>();
  const extraVisiblity: Record<string, boolean> = { muscles: true, vessels: true };
  const loadLayer = async (layer: ExtraLayer) => {
    if (loadedExtras.has(layer)) return 0;
    const entry = EXTRA_LAYERS.find((item) => item.id === layer)!;
    const extra: any = await new Promise((resolve, reject) => {
      loader.load(entry.file, resolve, undefined, () => reject(new Error(`${entry.label} could not be downloaded.`)));
    });
    const added: any[] = [];
    extra.scene.traverse((node: any) => { if (node.isMesh) added.push(node); });
    for (const node of added) attach(node, layer);
    loadedExtras.add(layer);
    for (const node of added) node.visible = extraVisiblity[layer] !== false;
    return added.length;
  };

  // Marker for the tapped spot: small glowing dot + ring, always drawn on top.
  const marker = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2d55, depthTest: false, transparent: true }),
  );
  dot.renderOrder = 10;
  marker.add(dot);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.028, 28),
    new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }),
  );
  ring.renderOrder = 10;
  marker.add(ring);
  marker.visible = false;
  group.add(marker);

  // ---- interaction: one finger rotates, two fingers pinch-zoom, a tap picks ----
  const pointers = new Map<number, { x: number; y: number }>();
  let travelled = 0;
  let pinchStart = 0;
  let zoomStart = HOME.z;
  let dragging = false;

  const rotate = (dx: number, dy: number) => {
    group.rotation.y += dx * 0.011;
    group.rotation.x = Math.max(-0.55, Math.min(0.55, group.rotation.x + dy * 0.006));
  };
  const zoomTo = (z: number) => { camera.position.z = Math.max(1.15, Math.min(6.5, z)); };

  const raycast = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    // three.js lowercases custom attributes, so the GLB's _PARTID arrives as _partid.
    const hit: any = hits.find((h: any) => h.object.visible && h.face && partIds(h.object));
    if (!hit) return;
    const id = partIds(hit.object).getX(hit.face.a) as number;
    const part = byId.get(id);
    marker.position.copy(group.worldToLocal(hit.point.clone()));
    marker.visible = true;
    onPick(id, part ? part.name : "Selected area");
  };

  const onPointerDown = (e: PointerEvent) => {
    renderer.domElement.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    travelled = 0;
    dragging = pointers.size === 1;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomStart = camera.position.z;
      dragging = false;
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      if (pinchStart) zoomTo(zoomStart * (pinchStart / distance));
      return;
    }
    travelled += Math.abs(dx) + Math.abs(dy);
    if (dragging) rotate(dx, dy);
  };
  const onPointerUp = (e: PointerEvent) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    dragging = false;
    if (wasSingle && travelled < 8) raycast(e.clientX, e.clientY);
    if (pointers.size < 2) pinchStart = 0;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomTo(camera.position.z * (1 + Math.sign(e.deltaY) * 0.12));
  };

  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const resize = () => {
    const w = host.clientWidth || width;
    const h = host.clientHeight || height;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const reduceMotion = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
  let frame = 0;
  let last = performance.now();
  let idle = 0;
  const tick = (now: number) => {
    const dt = Math.min(64, now - last);
    last = now;
    idle += dt;
    if (!reduceMotion && idle > 4000 && !dragging && pointers.size === 0) group.rotation.y += dt * 0.00018;
    ring.lookAt(camera.position);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  // Any touch restarts the idle timer so the body never spins while the patient is aiming.
  const wake = () => { idle = 0; };
  canvas.addEventListener("pointerdown", wake);
  frame = requestAnimationFrame(tick);
  onProgress(1);

  const handles: Handles = {
    reset: () => {
      group.rotation.set(0, 0, 0);
      zoomTo(HOME.z);
      marker.visible = false;
    },
    nudge: (direction: number) => { group.rotation.y += direction * 0.25; },
    zoomBy: (factor: number) => zoomTo(camera.position.z * factor),
    applyLayers: (layers: Layers) => {
      for (const mesh of pickables) {
        const system = mesh.userData.system as string;
        const visible = layers[system] !== false;
        mesh.visible = visible;
      }
    },
    loadLayer,
    setExtraVisible: (layer: ExtraLayer, visible: boolean) => {
      extraVisiblity[layer] = visible;
      for (const mesh of pickables) if (mesh.userData.layer === layer) mesh.visible = visible;
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", wake);
      scene.traverse((node: any) => {
        if (node.geometry) node.geometry.dispose?.();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m: any) => m.dispose?.());
        else material?.dispose?.();
      });
      renderer.dispose();
      canvas.remove();
    },
  };

  return { handles, parts, modelBytes };
}

export function BodyMapCard({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const handles = useRef<Handles | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [parts, setParts] = useState<BodyPart[]>([]);
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [layers, setLayers] = useState<Layers>({ skeletal: true });
  const [severity, setSeverity] = useState(5);
  const [since, setSince] = useState("0");
  const [note, setNote] = useState("");
  const [doctors, setDoctors] = useState<any[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [sending, setSending] = useState(false);
  const [safety, setSafety] = useState<{ level: string; action: string } | null>(null);
  const [mine, setMine] = useState<any[]>([]);
  const [downloadAnyway, setDownloadAnyway] = useState(false);
  const [allParts, setAllParts] = useState<BodyPart[]>([]);
  const [extras, setExtras] = useState<Record<ExtraLayer, "off" | "loading" | "on">>({ muscles: "off", vessels: "off" });

  useEffect(() => {
    api("/doctors").then((d) => setDoctors(d.doctors || [])).catch(() => {});
    api("/pain-reports/mine").then((d) => setMine(d.reports || [])).catch(() => {});
    // The flat list is only ~50 kB: fetch it even for phones that cannot render 3D,
    // so a pain report is always possible.
    fetch(PARTS_URL, { cache: "force-cache" })
      .then((r) => r.json())
      .then((m) => setAllParts(m.parts || []))
      .catch(() => {});
  }, []);

  useEffect(() => () => { handles.current?.dispose(); handles.current = null; }, []);

  const metered = looksMetered();
  const blocked = !webglAvailable() ? "This browser cannot show 3D. Use the 2D list below — your report still reaches the doctor." : "";

  async function open() {
    if (!host.current || phase === "loading") return;
    if (blocked) { setError(blocked); setPhase("error"); return; }
    setPhase("loading");
    setError("");
    try {
      const built = await buildBody(host.current, (id, name) => {
        const part = { id, name };
        setPicked(part);
      }, (fraction) => setProgress(fraction));
      handles.current = built.handles;
      setParts(built.parts);
      built.handles.applyLayers({ skeletal: true });
      setPhase("ready");
    } catch (x: any) {
      setError(x?.message || "The 3D model could not be opened.");
      setPhase("error");
    }
  }

  function toggleSystem(system: string) {
    const next = { ...layers, [system]: layers[system] === false };
    setLayers(next);
    handles.current?.applyLayers(next);
  }

  /** Optional layers are separate downloads, so switching one on may fetch ~1 MB first. */
  async function toggleExtra(layer: ExtraLayer) {
    const state = extras[layer];
    if (state === "on") {
      handles.current?.setExtraVisible(layer, false);
      setExtras((current) => ({ ...current, [layer]: "off" }));
      return;
    }
    if (state === "loading") return;
    const entry = EXTRA_LAYERS.find((item) => item.id === layer)!;
    if (metered && wifiOnly() && !downloadAnyway) {
      setMessage(`${entry.label} is an extra ${entry.size} download. Turn off "ask before mobile data" in Settings to load it here.`);
      return;
    }
    setExtras((current) => ({ ...current, [layer]: "loading" }));
    try {
      const added = await handles.current?.loadLayer(layer);
      handles.current?.setExtraVisible(layer, true);
      setExtras((current) => ({ ...current, [layer]: added ? "on" : "off" }));
      if (!added) setMessage(`${entry.label} could not be added to this view.`);
    } catch (x: any) {
      setExtras((current) => ({ ...current, [layer]: "off" }));
      setMessage(x?.message || `${entry.label} could not be downloaded.`);
    }
  }

  async function send(e: any) {
    e.preventDefault();
    if (!picked) { setMessage("Tap the place on the 3D body that hurts first."); return; }
    if (!doctorId) { setMessage("Choose the doctor you want to send this to."); return; }
    setSending(true);
    try {
      const res = await api("/pain-reports", { method: "POST", body: json({
        doctorId,
        bodyPart: picked.name,
        partId: picked.id,
        system: (parts.find((p) => p.id === picked.id) || allParts.find((p) => p.id === picked.id))?.system || "",
        severity,
        sinceDays: Number(since) || 0,
        note,
      }) });
      setSafety(res.safety || null);
      setMine([res.report, ...mine]);
      setNote("");
      setMessage(`Sent to the doctor: ${picked.name}. You will see the reply under "My sent reports".`);
    } catch (x: any) {
      setMessage(x.message);
    } finally { setSending(false); }
  }

  const systems = Array.from(new Set(parts.map((p) => p.system))).filter(Boolean);

  return <div className="grid">
    <article className="full bodymap">
      <h3>🫀 Tap where it hurts</h3>
      <p className="muted">Rotate the body, zoom in, then tap the exact spot that hurts. You choose one doctor and send it — they see the body part and how bad it is.</p>
      <p className="warn">Chest pain with sweating or breathlessness, severe breathing difficulty, stroke signs (face drooping, slurred speech, weakness on one side), heavy bleeding or fainting: <b>call 999 now</b>. Do not wait for an online reply.</p>

      {phase === "idle" && <div className="bodymap-start">
        <p className="muted">The 3D body is about 4 MB, so it only downloads when you ask for it.</p>
        {metered && wifiOnly() && !downloadAnyway
          ? <div className="notice">📶 You look like you are on mobile data. <button className="outline" onClick={() => { setWifiOnly(false); setDownloadAnyway(true); }}>Download on mobile data anyway</button></div>
          : <button className="primary" onClick={open} disabled={!!blocked}>Open the 3D body</button>}
        {blocked && <p className="warn">{blocked}</p>}
      </div>}

      {phase === "loading" && <div className="bodymap-start">
        <progress max={1} value={progress} />
        <p className="muted">Loading the body model… {Math.round(progress * 100)}%</p>
      </div>}

      {phase === "error" && <div className="notice"><b>The 3D view did not open.</b><p className="muted">{error}</p><button className="outline" onClick={open}>Try again</button></div>}

      <div className={"bodymap-stage" + (phase === "ready" ? "" : " hidden")}>
        <div className="bodymap-canvas" ref={host} />
        {phase === "ready" && <div className="bodymap-tools">
          <button className="outline" onClick={() => handles.current?.nudge(-1)} aria-label="Rotate left">⟲</button>
          <button className="outline" onClick={() => handles.current?.nudge(1)} aria-label="Rotate right">⟳</button>
          <button className="outline" onClick={() => handles.current?.zoomBy(0.82)} aria-label="Zoom in">＋</button>
          <button className="outline" onClick={() => handles.current?.zoomBy(1.22)} aria-label="Zoom out">−</button>
          <button className="outline" onClick={() => { handles.current?.reset(); setPicked(null); }}>Reset</button>
        </div>}
        {phase === "ready" && <p className="bodymap-hint">Drag to rotate · pinch or scroll to zoom · tap the painful spot</p>}
      </div>

      {phase === "ready" && systems.length > 0 && <div className="bodymap-layers">
        <span className="muted">Show:</span>
        {systems.map((system) => <button key={system} className={"chip" + (layers[system] === false ? " off" : "")} onClick={() => toggleSystem(system)} aria-pressed={layers[system] !== false}>{SYSTEM_LABEL[system] || system}</button>)}
      </div>}

      {phase === "ready" && <div className="bodymap-extras">
        <span className="muted">Extra layers:</span>
        {EXTRA_LAYERS.map((entry) => {
          const state = extras[entry.id];
          return <button key={entry.id} className={"chip" + (state === "on" ? " on" : "")} onClick={() => toggleExtra(entry.id)} aria-pressed={state === "on"}>
            {state === "loading" ? "⏳ " : state === "on" ? "✓ " : "＋ "}{entry.label}
            <small>{state === "on" ? " shown" : " " + entry.size}</small>
          </button>;
        })}
      </div>}
      {phase === "ready" && (extras.muscles !== "off" || extras.vessels !== "off") && <p className="bodymap-hint-inline">Muscles are see-through so the bones and organs stay visible. Tap the body again after switching layers — the nearest surface under your finger is what gets reported.</p>}

      <form className="bodymap-form" onSubmit={send}>
        <label>Or pick from the list (works without 3D)
          <select value={picked?.id ?? ""} onChange={(e) => {
            const id = Number(e.target.value);
            const found = allParts.find((p) => p.id === id) || parts.find((p) => p.id === id);
            setPicked(found ? { id: found.id, name: found.name } : null);
          }}>
            <option value="">Choose a body part…</option>
            {Array.from(new Set(allParts.map((p) => `${p.layer || "body"}|${p.system}`))).map((key) => {
              const [layer, system] = key.split("|");
              return <optgroup key={key} label={layer === "body" ? (SYSTEM_LABEL[system] || system) : `${layer === "muscles" ? "Muscle" : "Vessel"} · ${system}`}>
                {allParts.filter((p) => (p.layer || "body") === layer && p.system === system).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>;
            })}
          </select>
        </label>
        <div className="bodymap-picked">
          {picked ? <>📍 Selected: <b>{picked.name}</b> <button type="button" className="linkish" onClick={() => setPicked(null)}>clear</button></> : <span className="muted">Nothing selected yet — tap the body above.</span>}
        </div>
        <label>How bad is the pain? <b>{severity}/10</b>
          <input type="range" min={1} max={10} step={1} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} />
        </label>
        <label>How long has it been there?
          <select value={since} onChange={(e) => setSince(e.target.value)}>
            {SINCE_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label>Anything else the doctor should know (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder="e.g. worse when I walk, burning feeling, started after a fall…" />
        </label>
        <label>Send to which doctor?
          <DoctorPicker token={token} doctors={doctors} value={doctorId} onChange={setDoctorId} />
        </label>
        <button className="primary" disabled={sending || !picked || !doctorId}>{sending ? "Sending…" : "📨 Send this pain report"}</button>
      </form>

      {safety && safety.level !== "routine" && <div className="notice danger">
        <b>{safety.level === "emergency" ? "This needs emergency care now." : "A doctor should see this soon."}</b>
        <p>{safety.action}</p>
      </div>}

      <details className="bodymap-attribution">
        <summary>Where this body model comes from</summary>
        <p>Body data: <b>BodyParts3D 4.0</b>, Database Center for Life Science (DBCLS), Japan — licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. This app simplified the meshes and re-coloured them; the anatomy itself is unchanged. <a href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">Source</a></p>
        <p className="muted">It is a learning and communication aid, not a diagnostic image. Your doctor still examines you.</p>
      </details>
    </article>

    <article className="full">
      <h3>My sent pain reports</h3>
      {mine.length === 0 && <p className="muted">Nothing sent yet. Reports you send from the body map appear here with the doctor's reply.</p>}
      {mine.map((r) => <div className="item" key={r._id}>
        <b>{r.bodyPart}</b> · {r.severity}/10 · {fmtDate(r.createdAt)}
        <p className="muted">{r.doctorId?.name ? "Dr. " + r.doctorId.name : "Doctor"}{r.doctorId?.doctorProfile?.specialty ? " (" + r.doctorId.doctorProfile.specialty + ")" : ""} · {r.status === "new" ? "Sent, not opened yet" : r.status === "acknowledged" ? "Doctor saw it" : "Doctor replied"}</p>
        {r.note && <p>{r.note}</p>}
        {r.doctorReply && <div className="notice">🩺 {r.doctorReply}</div>}
        {r.urgency === "emergency" && <p className="warn">This report had emergency warning signs. If you still have them, call 999.</p>}
      </div>)}
    </article>
  </div>;
}

export function DoctorBodyReports({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  async function load() {
    try { const d = await api("/doctor/pain-reports"); setList(d.reports || []); }
    catch (e: any) { setMessage(e.message); }
  }
  useEffect(() => { load(); }, []);
  async function acknowledge(id: string) {
    try {
      await api(`/pain-reports/${id}/acknowledge`, { method: "POST", body: json({ reply: reply[id] || "" }) });
      setMessage("Patient notified.");
      setReply((r) => ({ ...r, [id]: "" }));
      load();
    } catch (e: any) { setMessage(e.message); }
  }
  return <div className="grid"><article className="full">
    <h3>Body-map pain reports</h3>
    <p className="muted">Patients marked a spot on the 3D body and sent it to you. Red-flag reports are screened by rule, not by AI — always judge for yourself.</p>
    <button className="outline" onClick={load}>↻ Refresh</button>
    {list.length === 0 && <p className="muted">No reports yet. New ones appear here and as a notification.</p>}
    {list.map((r) => <div className="item" key={r._id}>
      <b>{r.patientId?.name || "Patient"}</b> · {fmtDate(r.createdAt)} · <b>{r.bodyPart}</b> · pain {r.severity}/10
      {r.sinceDays ? <span> · for {r.sinceDays >= 30 ? "over a month" : r.sinceDays + " day(s)"}</span> : <span> · since today</span>}
      {r.urgency !== "routine" && <p className="warn">{r.urgency === "emergency" ? "⚠️ Emergency warning signs were mentioned." : "⚠️ Urgent: needs a reply soon."}</p>}
      {r.note && <p>{r.note}</p>}
      <p className="muted">Status: {r.status === "new" ? "not opened" : r.status === "acknowledged" ? "seen" : "replied"}</p>
      {r.doctorReply && <div className="notice">Your reply: {r.doctorReply}</div>}
      <textarea rows={2} maxLength={1000} placeholder="Optional short reply to the patient…" value={reply[r._id] || ""} onChange={(e) => setReply((x) => ({ ...x, [r._id]: e.target.value }))} />
      <button className="primary" onClick={() => acknowledge(r._id)}>✅ Mark seen and notify patient</button>
    </div>)}
  </article></div>;
}
