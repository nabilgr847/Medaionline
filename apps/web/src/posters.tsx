// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Health posters shown on the home page and in the staff portal.
// Each card is a real photograph with the headline drawn by the page (not baked into the
// image), so the Bangla and English wording stays sharp and can be translated later.
import { useRef } from "react";

type Poster = {
  image: string;
  eyebrow: string;
  eyebrowBn: string;
  title: string;
  titleBn: string;
  body: string;
  cta: string;
  href?: string;
  action?: "signin" | "install";
};

const POSTERS: Poster[] = [
  {
    image: "/branding/posters/telecare.jpg",
    eyebrow: "ONLINE CONSULTATION",
    eyebrowBn: "অনলাইন পরামর্শ",
    title: "See a doctor without the queue",
    titleBn: "লাইনে দাঁড়ানো ছাড়াই ডাক্তার দেখুন",
    body: "Video or audio visit from home. Prescription signed digitally, delivered to your phone.",
    cta: "Request an appointment",
    action: "signin",
  },
  {
    image: "/branding/posters/checkup.jpg",
    eyebrow: "HEALTH CHECK",
    eyebrowBn: "স্বাস্থ্য পরীক্ষা",
    title: "Know your numbers early",
    titleBn: "আগেই জানুন আপনার রক্তচাপ ও সুগার",
    body: "Blood pressure, sugar and reports in one place — reviewed by a registered doctor.",
    cta: "Open my health profile",
    action: "signin",
  },
  {
    image: "/branding/posters/medicines.jpg",
    eyebrow: "MEDICINE TRACKER",
    eyebrowBn: "ঔষধ ট্র্যাকার",
    title: "Never miss a dose again",
    titleBn: "একটি ওষুধও আর বাদ পড়বে না",
    body: "Free reminders, taken/skipped log and a weekly adherence score you can show your doctor.",
    cta: "Install the app",
    action: "install",
  },
];

export function PosterStrip({ onSignIn, onInstall }: { onSignIn: () => void; onInstall?: () => void }) {
  const rail = useRef<HTMLDivElement | null>(null);

  const scrollBy = (direction: number) => {
    const node = rail.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.min(420, node.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <section className="posters" aria-label="Health posters">
      <div className="posters-head">
        <div>
          <h2>Care that fits your day</h2>
          <p className="muted">Three ways MedAI Hospital helps between visits.</p>
        </div>
        <div className="posters-nav">
          <button className="outline" onClick={() => scrollBy(-1)} aria-label="Previous posters">←</button>
          <button className="outline" onClick={() => scrollBy(1)} aria-label="Next posters">→</button>
        </div>
      </div>

      <div className="posters-rail" ref={rail}>
        {POSTERS.map((poster) => (
          <article className="poster" key={poster.image}>
            <img src={poster.image} alt="" loading="lazy" width={768} height={1024} />
            <div className="poster-body">
              <span className="poster-eyebrow">{poster.eyebrow} · {poster.eyebrowBn}</span>
              <h3>{poster.title}</h3>
              <p className="poster-bn">{poster.titleBn}</p>
              <p className="poster-text">{poster.body}</p>
              <button
                className="primary"
                onClick={() => (poster.action === "install" && onInstall ? onInstall() : onSignIn())}
              >
                {poster.action === "install" && onInstall ? poster.cta : poster.cta}
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="posters-note muted">Posters are informational. For chest pain, breathing difficulty, stroke signs or heavy bleeding, call 999 — do not wait for an online visit.</p>
    </section>
  );
}
