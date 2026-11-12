// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// 3D anatomy viewer.
//
// Design rules that matter for a hospital app on a Bangladeshi mobile connection:
//   * three.js is downloaded ONLY when the patient taps "Open 3D view" (lazy import),
//     so the normal app stays small and fast.
//   * on mobile data it asks first — the "3D on Wi-Fi only" switch is on by default.
//   * if WebGL is unavailable or the download fails, a 2D explanation is shown instead;
//     the feature never breaks the page.
//   * the models are built from simple geometry (no large glTF download) and are teaching
//     illustrations, not diagnostic images — the caption says so.
import { useEffect, useRef, useState } from "react";

type Organ = "heart" | "lungs" | "brain" | "kidney" | "eye" | "spine";

type Hotspot = { name: string; note: string; at: [number, number, number] };
type Question = { q: string; options: string[]; answer: number; why: string };
type OrganInfo = {
  id: Organ;
  name: string;
  icon: string;
  caption: string;
  hotspots: Hotspot[];
  quiz: Question[];
};

const ORGANS: OrganInfo[] = [
  {
    id: "heart", name: "Heart", icon: "🫀",
    caption: "A four-chamber pump. It pushes blood to the lungs for oxygen, then around the body.",
    hotspots: [
      { name: "Aorta", note: "The largest artery — carries oxygen-rich blood out to the body.", at: [0.9, 1.6, 0.2] },
      { name: "Right atrium", note: "Receives oxygen-poor blood coming back from the body.", at: [-0.7, 1.0, 0.3] },
      { name: "Left ventricle", note: "The strongest chamber; pumps blood into the aorta.", at: [0.5, -0.8, 0.6] },
      { name: "Coronary vessels", note: "Small arteries on the surface that feed the heart muscle itself.", at: [-0.4, -0.3, 1.1] },
    ],
    quiz: [
      { q: "Which chamber pumps blood into the aorta?", options: ["Right atrium", "Left ventricle", "Right ventricle", "Left atrium"], answer: 1, why: "The left ventricle has the thickest wall because it pushes blood around the whole body." },
      { q: "What does the aorta carry?", options: ["Oxygen-poor blood to the lungs", "Oxygen-rich blood to the body", "Digested food", "Air"], answer: 1, why: "The aorta is the body's main artery: oxygen-rich blood leaves the left ventricle through it." },
      { q: "How many chambers does the heart have?", options: ["Two", "Three", "Four", "Six"], answer: 2, why: "Two atria on top and two ventricles below." },
      { q: "The coronary arteries supply…", options: ["The lungs", "The heart muscle itself", "The kidneys", "The skin"], answer: 1, why: "If they narrow, the heart muscle itself lacks blood — that is what causes angina and heart attacks." },
    ],
  },
  {
    id: "lungs", name: "Lungs", icon: "🫁",
    caption: "Air goes down the trachea into two lungs, where oxygen crosses into the blood.",
    hotspots: [
      { name: "Trachea", note: "The windpipe; rings of cartilage keep it open.", at: [0, 1.9, 0] },
      { name: "Bronchi", note: "The trachea splits into two tubes, one for each lung.", at: [0.55, 0.9, 0] },
      { name: "Left lung", note: "Slightly smaller, because the heart sits on this side.", at: [-1.15, -0.2, 0.5] },
      { name: "Alveoli", note: "Tiny air sacs where oxygen enters the blood and carbon dioxide leaves.", at: [1.15, -0.9, 0.5] },
    ],
    quiz: [
      { q: "Where does oxygen enter the blood?", options: ["In the trachea", "In the alveoli", "In the bronchi", "In the nose"], answer: 1, why: "Alveoli are tiny sacs with very thin walls and many capillaries around them." },
      { q: "Why is the left lung a little smaller?", options: ["It is weaker", "The heart takes that space", "It has fewer alveoli", "It holds less air on purpose"], answer: 1, why: "The heart sits slightly to the left, so that lung has a notch for it." },
      { q: "The trachea is kept open by…", options: ["Muscle", "Rings of cartilage", "Fat", "Bone"], answer: 1, why: "Cartilage rings stop the windpipe from collapsing when you breathe in." },
      { q: "Which gas do you breathe out in larger amounts?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], answer: 2, why: "Cells produce carbon dioxide, which the blood carries back to the lungs to be exhaled." },
    ],
  },
  {
    id: "brain", name: "Brain", icon: "🧠",
    caption: "Two hemispheres, four lobes each. It controls movement, senses, memory and speech.",
    hotspots: [
      { name: "Frontal lobe", note: "Planning, judgement, voluntary movement and speech.", at: [-0.9, 0.5, 0.9] },
      { name: "Parietal lobe", note: "Touch, temperature and body position.", at: [0.6, 0.9, 0.4] },
      { name: "Temporal lobe", note: "Hearing, language, and the forming of new memories.", at: [-1.2, -0.3, 0.2] },
      { name: "Brainstem", note: "Breathing, heart rate and blood pressure — automatic life support.", at: [0, -1.9, 0] },
    ],
    quiz: [
      { q: "Which lobe is mainly for planning and judgement?", options: ["Frontal", "Occipital", "Temporal", "Parietal"], answer: 0, why: "The frontal lobe handles decision-making, movement and speech production." },
      { q: "Breathing and heart rate are controlled by…", options: ["The cerebellum", "The brainstem", "The frontal lobe", "The spinal cord only"], answer: 1, why: "The brainstem keeps these automatic functions going even while you sleep." },
      { q: "Hearing is processed in which lobe?", options: ["Temporal", "Frontal", "Parietal", "Occipital"], answer: 0, why: "The temporal lobe sits near the ear and handles sound and some memory." },
      { q: "How many lobes in each hemisphere?", options: ["Two", "Three", "Four", "Five"], answer: 2, why: "Frontal, parietal, temporal and occipital." },
    ],
  },
  {
    id: "kidney", name: "Kidney", icon: "🫘",
    caption: "A bean-shaped filter. It removes waste, balances salt and water, and helps control blood pressure.",
    hotspots: [
      { name: "Cortex", note: "The outer layer, where blood is first filtered.", at: [-0.9, 0.8, 0.4] },
      { name: "Medulla", note: "Inner cones that concentrate urine.", at: [0.5, -0.4, 0.6] },
      { name: "Renal pelvis", note: "Collects urine and sends it down the ureter.", at: [0.9, -1.0, 0.1] },
      { name: "Renal artery", note: "Brings about a fifth of every heartbeat to be filtered.", at: [0.2, 1.6, 0.2] },
    ],
    quiz: [
      { q: "What is the main job of a kidney?", options: ["Digest food", "Filter blood and make urine", "Pump blood", "Store bile"], answer: 1, why: "The kidney filters waste from blood, and balances water and salts." },
      { q: "Urine leaves the kidney through the…", options: ["Renal artery", "Ureter", "Aorta", "Urethra"], answer: 1, why: "The renal pelvis collects urine, which leaves through the ureter to the bladder." },
      { q: "How many kidneys does a person usually have?", options: ["One", "Two", "Three", "Four"], answer: 1, why: "Two — one on each side of the spine. One working kidney can be enough, but two is normal." },
      { q: "A common sign of kidney trouble is…", options: ["Sneezing", "Swelling in the legs and foamy urine", "Blurred vision only", "Hair loss"], answer: 1, why: "Fluid can build up when the kidneys cannot remove it; protein in urine makes it foamy. A doctor confirms with tests." },
    ],
  },
  {
    id: "eye", name: "Eye", icon: "👁️",
    caption: "Light passes the cornea and lens, and the retina turns it into signals for the brain.",
    hotspots: [
      { name: "Cornea", note: "The clear front window that does most of the focusing.", at: [0, 0.1, 1.35] },
      { name: "Iris & pupil", note: "The coloured ring; the pupil is the opening that changes size with light.", at: [0, 0.15, 1.15] },
      { name: "Lens", note: "Fine-tunes focus, changing shape to look near or far.", at: [0.5, 0.4, 0.9] },
      { name: "Optic nerve", note: "Carries the picture to the brain.", at: [-0.2, -0.2, -1.3] },
    ],
    quiz: [
      { q: "Which part focuses light the most?", options: ["The cornea", "The eyelid", "The optic nerve", "The sclera"], answer: 0, why: "The cornea bends light first and does most of the focusing; the lens fine-tunes it." },
      { q: "The pupil gets bigger in…", options: ["Bright light", "Dim light", "Cold weather", "Sleep only"], answer: 1, why: "A wider pupil lets in more light when it is dark." },
      { q: "The retina does what?", options: ["Makes tears", "Turns light into nerve signals", "Moves the eye", "Protects from dust"], answer: 1, why: "Light-sensitive cells in the retina convert light into signals sent by the optic nerve." },
      { q: "Sudden loss of vision in one eye is…", options: ["Normal tiredness", "A reason to seek care immediately", "Fixed by blinking", "Always a headache"], answer: 1, why: "Sudden vision loss can be a stroke or retinal problem — treat it as an emergency and get help at once." },
    ],
  },
  {
    id: "spine", name: "Spine", icon: "🦴",
    caption: "Twenty-four vertebrae stack into one column that carries the body's weight and protects the spinal cord.",
    hotspots: [
      { name: "Cervical (7)", note: "The neck; supports the head and lets it turn.", at: [0.25, 1.9, 0] },
      { name: "Thoracic (12)", note: "The mid-back; the ribs attach here.", at: [-0.3, 0.4, 0] },
      { name: "Lumbar (5)", note: "The lower back; carries most of the body's weight — a common place for pain.", at: [0.4, -1.2, 0] },
      { name: "Discs", note: "Soft cushions between vertebrae; they absorb shock.", at: [-0.5, -0.4, 0.3] },
    ],
    quiz: [
      { q: "How many vertebrae in the lumbar (lower back) region?", options: ["Five", "Seven", "Twelve", "Twenty-four"], answer: 0, why: "Five lumbar vertebrae carry most of the upper body's weight." },
      { q: "What protects the spinal cord?", options: ["Muscle only", "The bony vertebral column", "The ribs", "The skin"], answer: 1, why: "Vertebrae form a ring of bone around the spinal cord." },
      { q: "A herniated disc means…", options: ["Bone is broken", "A disc pushes on a nerve", "The spine is curved", "A muscle is torn"], answer: 1, why: "The soft centre of a disc can bulge and press a nerve, causing pain or numbness down a leg." },
      { q: "The cervical spine is in the…", options: ["Neck", "Chest", "Lower back", "Pelvis"], answer: 0, why: "Seven cervical vertebrae form the neck." },
    ],
  },
];

const WIFI_KEY = "medai_3d_wifi_only";
const BEST_KEY = "medai_anatomy_best";

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

type SceneHandles = {
  dispose: () => void;
  setLabelsVisible: (visible: boolean) => void;
};

/** Simple shapes are enough to explain the organ, and they download instantly. */
async function buildScene(
  canvasHost: HTMLDivElement,
  overlay: HTMLDivElement,
  organ: OrganInfo,
  onHotspot: (index: number) => void,
): Promise<SceneHandles> {
  const THREE = await import("three");
  const width = canvasHost.clientWidth || 320;
  const height = canvasHost.clientHeight || 280;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 7);

  scene.add(new THREE.AmbientLight(0xffffff, 0.68));
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

  // ---- heart ----
  if (organ.id === "heart") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.45, 48, 32), material(0xc0392b));
    body.scale.set(1, 1.18, 0.92);
    group.add(body);
    const atrium = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 24), material(0xd9534f));
    atrium.position.set(-0.62, 0.95, 0.25);
    group.add(atrium);
    const aorta = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 20, 40, Math.PI * 1.5), material(0xe0675f));
    aorta.position.set(0.7, 1.2, 0);
    aorta.rotation.z = -0.5;
    group.add(aorta);
    const artery = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 1.5, 20), material(0xa93226));
    artery.position.set(0.85, 1.85, 0);
    artery.rotation.z = 0.22;
    group.add(artery);
  }

  // ---- lungs ----
  if (organ.id === "lungs") {
    const lungMat = material(0xe98ba0, 0.92);
    for (const x of [-1.05, 1.05]) {
      const lung = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), lungMat);
      lung.scale.set(0.85, 1.5, 0.8);
      lung.position.set(x, -0.15, 0);
      group.add(lung);
    }
    const trachea = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 20), material(0xb7d4e6));
    trachea.position.set(0, 1.55, 0);
    group.add(trachea);
    for (const x of [-0.55, 0.55]) {
      const bronchus = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 16), material(0xb7d4e6));
      bronchus.position.set(x * 1.3, 0.75, 0);
      bronchus.rotation.z = x > 0 ? -0.6 : 0.6;
      group.add(bronchus);
    }
  }

  // ---- brain ----
  if (organ.id === "brain") {
    for (const x of [-0.85, 0.85]) {
      const hemi = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 32), material(0xf0a9b8));
      hemi.scale.set(1, 0.92, 1.15);
      hemi.position.set(x, 0.1, 0);
      group.add(hemi);
      const cortex = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.28, 2),
        new THREE.MeshStandardMaterial({ color: 0xf7c1cc, wireframe: true, transparent: true, opacity: 0.45 }),
      );
      cortex.position.set(x, 0.1, 0);
      cortex.scale.set(1, 0.94, 1.16);
      group.add(cortex);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.4, 20), material(0xe4a3ae));
    stem.position.set(0, -1.35, 0);
    group.add(stem);
  }

  // ---- kidney: a bean, made by pulling one side of a sphere inwards ----
  if (organ.id === "kidney") {
    const bean = new THREE.SphereGeometry(1.15, 56, 40);
    const pos = bean.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const dent = Math.max(0, 1 - Math.abs(y) / 1.5);
      if (x > 0) x -= 1.0 * dent * dent;          // the concave side (hilum)
      pos.setXYZ(i, x, y * 1.25, z * 0.85);
    }
    bean.computeVertexNormals();
    group.add(new THREE.Mesh(bean, material(0xa4442f)));
    const ureter = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 1.5, 16), material(0xd9c2a3));
    ureter.position.set(0.55, -1.65, 0);
    ureter.rotation.z = 0.25;
    group.add(ureter);
    const artery = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 16), material(0xc0392b));
    artery.position.set(0.55, 1.25, 0);
    artery.rotation.z = -0.35;
    group.add(artery);
  }

  // ---- eye ----
  if (organ.id === "eye") {
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(1.2, 48, 36), material(0xf7fafc));
    group.add(sclera);
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 48),
      new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.3 }),
    );
    iris.position.set(0, 0, 1.13);
    group.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), material(0x0b1220));
    pupil.position.set(0, 0, 1.14);
    group.add(pupil);
    const cornea = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 40, 28, 0, Math.PI * 2, 0, Math.PI / 2.2),
      new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.35, roughness: 0.05 }),
    );
    cornea.position.set(0, 0, 0.95);
    cornea.rotation.x = Math.PI / 2;
    group.add(cornea);
    const nerve = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.2, 20), material(0xf1d2b0));
    nerve.position.set(-0.15, -0.2, -1.45);
    nerve.rotation.x = Math.PI / 2;
    group.add(nerve);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), material(0xdff1ff, 0.55));
    lens.position.set(0, 0.05, 0.8);
    lens.scale.set(1, 1, 0.5);
    group.add(lens);
  }

  // ---- spine: 24 vertebrae stacked along a gentle S curve ----
  if (organ.id === "spine") {
    const boneMat = material(0xe8e2d5);
    const discMat = material(0x9db6c9);
    const total = 24;
    for (let i = 0; i < total; i++) {
      const t = i / (total - 1);               // 0 = top
      const y = 2.1 - t * 4.4;
      const z = 0.42 * Math.sin(t * Math.PI * 1.1) - 0.1;
      const vertebra = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.32, 0.15, 20), boneMat);
      vertebra.position.set(0, y, z);
      group.add(vertebra);
      const spinous = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.34), boneMat);
      spinous.position.set(0, y, z - 0.3);
      group.add(spinous);
      if (i < total - 1) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 20), discMat);
        disc.position.set(0, y - 0.11, z);
        group.add(disc);
      }
    }
  }

  // ---- hotspots: buttons that follow the model ----
  const dots: { el: HTMLButtonElement; anchor: any }[] = [];
  let labelsVisible = true;
  organ.hotspots.forEach((spot, index) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "anatomy-hotspot";
    el.setAttribute("aria-label", spot.name);
    el.innerHTML = `<i></i><span>${spot.name}</span>`;
    el.addEventListener("click", (e) => { e.preventDefault(); onHotspot(index); });
    overlay.appendChild(el);
    dots.push({ el, anchor: new THREE.Vector3(spot.at[0], spot.at[1], spot.at[2]) });
  });

  let frame = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let velocity = 0.004;
  let rotationX = 0;
  const projected = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const toCamera = new THREE.Vector3();

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
    group.updateMatrixWorld();

    const w = overlay.clientWidth || width;
    const h = overlay.clientHeight || height;
    for (const dot of dots) {
      worldPoint.copy(dot.anchor).applyMatrix4(group.matrixWorld);
      normal.copy(worldPoint).normalize();
      toCamera.copy(camera.position).sub(worldPoint).normalize();
      projected.copy(worldPoint).project(camera);
      const facingCamera = normal.dot(toCamera) > -0.15;   // hide points on the far side
      const inside = projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
      const visible = labelsVisible && facingCamera && inside;
      dot.el.style.display = visible ? "" : "none";
      if (visible) {
        dot.el.style.left = `${(projected.x * 0.5 + 0.5) * w}px`;
        dot.el.style.top = `${(-projected.y * 0.5 + 0.5) * h}px`;
      }
    }

    renderer.render(scene, camera);
  };
  animate();

  return {
    setLabelsVisible(visible: boolean) {
      labelsVisible = visible;
      if (!visible) dots.forEach((d) => { d.el.style.display = "none"; });
    },
    dispose() {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dots.forEach((d) => d.el.remove());
      scene.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === canvasHost) canvasHost.removeChild(renderer.domElement);
    },
  };
}

function Quiz({ organ }: { organ: OrganInfo }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [best, setBest] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const map = raw ? JSON.parse(raw) : {};
      setBest(Number(map[organ.id] || 0));
    } catch { setBest(0); }
    setIndex(0); setPicked(null); setScore(0); setDone(false);
  }, [organ.id]);

  const question = organ.quiz[index];

  function choose(option: number) {
    if (picked !== null) return;
    setPicked(option);
    if (option === question.answer) setScore((s) => s + 1);
  }

  function next() {
    if (index + 1 >= organ.quiz.length) {
      const finalScore = score;          // choose() already counted the last answer
      setDone(true);
      try {
        const raw = localStorage.getItem(BEST_KEY);
        const map = raw ? JSON.parse(raw) : {};
        if (finalScore > Number(map[organ.id] || 0)) {
          map[organ.id] = finalScore;
          localStorage.setItem(BEST_KEY, JSON.stringify(map));
          setBest(finalScore);
        }
      } catch { /* ignore */ }
      return;
    }
    setIndex((i) => i + 1);
    setPicked(null);
  }

  if (done) {
    return (
      <div className="anatomy-quiz">
        <b>Quiz finished — {score} / {organ.quiz.length}</b>
        <p className="muted small">Best score for the {organ.name.toLowerCase()}: {Math.max(best, score)} / {organ.quiz.length}</p>
        <button className="outline" onClick={() => { setIndex(0); setPicked(null); setScore(0); setDone(false); }}>Try again</button>
      </div>
    );
  }

  return (
    <div className="anatomy-quiz">
      <div className="anatomy-quiz-top">
        <b>Question {index + 1} of {organ.quiz.length}</b>
        <span className="muted small">Score {score}</span>
      </div>
      <p className="anatomy-question">{question.q}</p>
      <div className="anatomy-options">
        {question.options.map((option, i) => {
          const state = picked === null ? "" : i === question.answer ? "correct" : i === picked ? "wrong" : "dim";
          return (
            <button key={option} className={state} disabled={picked !== null} onClick={() => choose(i)}>
              {option}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="anatomy-why">
          <b>{picked === question.answer ? "Correct" : "Not quite"}</b> — {question.why}
          <button className="primary" onClick={next}>{index + 1 >= organ.quiz.length ? "See score" : "Next question"}</button>
        </div>
      )}
    </div>
  );
}

export function AnatomyCard() {
  const [organId, setOrganId] = useState<Organ>("heart");
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState(true);
  const [hotspot, setHotspot] = useState<number | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error" | "ask">("idle");
  const [note, setNote] = useState("");
  const [wifi, setWifiState] = useState(() => wifiOnly());
  const canvas = useRef<HTMLDivElement | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const handles = useRef<SceneHandles | null>(null);

  const organ = ORGANS.find((o) => o.id === organId)!;

  function teardown() {
    handles.current?.dispose();
    handles.current = null;
  }

  async function start(force = false) {
    if (!force && wifi && looksMetered()) { setStatus("ask"); return; }
    if (!webglAvailable()) { setStatus("error"); setNote("This device cannot show 3D (WebGL is off). The notes below describe the same organ."); return; }
    setStatus("loading");
    setNote("");
    try {
      await new Promise((r) => setTimeout(r, 30));       // let the spinner paint first
      if (!canvas.current || !overlay.current) return;
      handles.current = await buildScene(canvas.current, overlay.current, organ, (index) => setHotspot(index));
      handles.current.setLabelsVisible(labels);
      setStatus("ready");
    } catch (e: any) {
      setStatus("error");
      setNote("Could not load the 3D view (" + (e?.message || "network") + "). The notes below describe the same organ.");
    }
  }

  // Rebuild the model when the organ changes while open.
  useEffect(() => {
    if (!open) { teardown(); return; }
    teardown();
    setHotspot(null);
    setStatus("idle");
    start();
    return () => teardown();
  }, [open, organId]);

  useEffect(() => { handles.current?.setLabelsVisible(labels); }, [labels]);

  function close() {
    teardown();
    setOpen(false);
    setStatus("idle");
    setHotspot(null);
    setQuizOpen(false);
  }

  return (
    <article className="anatomy">
      <div className="anatomy-head">
        <div>
          <h3>3D anatomy</h3>
          <p className="muted small">Six organs from every side, with labels and a short quiz. Pictures for learning only — not for diagnosis.</p>
        </div>
        {!open
          ? <button className="primary" onClick={() => setOpen(true)}>Open 3D view</button>
          : <button className="outline" onClick={close}>Close</button>}
      </div>

      {open && (
        <>
          <div className="anatomy-tabs" role="tablist">
            {ORGANS.map((o) => (
              <button key={o.id} role="tab" aria-selected={o.id === organId}
                className={o.id === organId ? "active" : ""} onClick={() => setOrganId(o.id)}>
                <span aria-hidden="true">{o.icon}</span> {o.name}
              </button>
            ))}
          </div>

          <div className="anatomy-stage">
            <div ref={canvas} className="anatomy-canvas" aria-label={`3D model of the ${organ.name.toLowerCase()}`} />
            <div ref={overlay} className="anatomy-overlay" aria-hidden={status !== "ready"} />

            {status !== "ready" && (
              <div className="anatomy-fallback">
                {status === "loading" && <><span className="spinner" aria-hidden="true" /><b>Loading the 3D model…</b><p>The first time can take a few seconds.</p></>}
                {status === "ask" && <>
                  <b>You are on mobile data</b>
                  <p>The 3D model is about 750 KB. Load it now, or wait until you are on Wi-Fi.</p>
                  <div className="row">
                    <button className="primary" onClick={() => start(true)}>Load anyway</button>
                    <button className="outline" onClick={close}>Not now</button>
                  </div>
                </>}
                {status === "error" && <><span aria-hidden="true">{organ.icon}</span><b>{organ.name}</b><p>{note}</p></>}
                {status === "idle" && <><span aria-hidden="true">{organ.icon}</span><b>{organ.name}</b><p>{organ.caption}</p></>}
              </div>
            )}
          </div>

          {status === "ready" && (
            <div className="anatomy-tools">
              <label className="check">
                <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
                Show labels
              </label>
              <span className="muted small">Drag the model to turn it.</span>
            </div>
          )}

          <p className="anatomy-caption">{organ.caption}</p>

          {hotspot !== null && organ.hotspots[hotspot] && (
            <div className="anatomy-note" role="status">
              <b>{organ.hotspots[hotspot].name}</b>
              <p>{organ.hotspots[hotspot].note}</p>
              <button className="link" onClick={() => setHotspot(null)}>Close</button>
            </div>
          )}

          <div className="anatomy-actions">
            <button className="outline" onClick={() => { setHotspot(null); setQuizOpen((v) => !v); }}>
              {quizOpen ? "Hide quiz" : "Take the quiz"}
            </button>
            <label className="check anatomy-pref">
              <input type="checkbox" checked={wifi} onChange={(e) => { setWifiState(e.target.checked); setWifiOnly(e.target.checked); }} />
              Ask before loading 3D on mobile data
            </label>
          </div>

          {quizOpen && <Quiz organ={organ} />}
        </>
      )}
    </article>
  );
}
