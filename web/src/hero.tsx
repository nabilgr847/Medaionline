// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// The home banner has two genuinely different designs:
//   phone  -> full-bleed picture, text ON the picture, one thumb-sized button
//   desktop-> split hero: message on the left, artwork card on the right, quick stats
// Both read the same data, so the admin banner editor keeps working unchanged.
import { useEffect, useRef, useState } from "react";
import { useView } from "./viewport";

type Slide = { eyebrow?: string; title?: string; subtitle?: string; pills?: string[]; linkText?: string; linkUrl?: string; image?: string };

function slidesFor(banner: any): Slide[] {
  const slides: Slide[] = Array.isArray(banner?.slides) ? banner.slides : [];
  if (!banner?.active || !slides.length) return [];
  return slides.filter((s) => !s || s.title || s.image);
}

export function HomeHero({ banner, onPrimary, signedIn }: { banner: any; onPrimary: () => void; signedIn?: boolean }) {
  const view = useView();
  const slides = slidesFor(banner);
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const touch = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => { setI(0); }, [slides.length]);
  useEffect(() => {
    if (slides.length < 2 || hold) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % slides.length), Math.max(4, banner?.intervalSec || 6) * 1000);
    return () => window.clearInterval(t);
  }, [slides.length, hold, banner?.intervalSec]);

  if (!slides.length) return null;
  const s = slides[i % slides.length];
  const art = s.image || "/branding/medai-banner.png";
  const primaryLabel = signedIn ? "Open my dashboard" : "Sign in or create an account";

  const dots = slides.length > 1 ? (
    <div className="hero2-dots" role="tablist" aria-label="Banner slides">
      {slides.map((_, n) => (
        <button key={n} type="button" role="tab" aria-selected={n === i % slides.length}
          aria-label={"Slide " + (n + 1)} className={n === i % slides.length ? "on" : ""} onClick={() => setI(n)} />
      ))}
    </div>
  ) : null;

  /* ------------------------------- phone ------------------------------- */
  if (view === "mobile") {
    return (
      <section className="hero2 mobile" aria-label="MedAI highlights"
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, t: Date.now() }; }}
        onTouchEnd={(e) => {
          const start = touch.current; touch.current = null;
          if (!start || slides.length < 2) return;
          const dx = e.changedTouches[0].clientX - start.x;
          if (Math.abs(dx) < 40 || Date.now() - start.t > 800) return;
          setI((x) => (dx < 0 ? (x + 1) % slides.length : (x - 1 + slides.length) % slides.length));
        }}>
        <div key={"m" + i} className="hero2-card slidefade">
          <img src={art} alt="" className="hero2-bg" />
          <div className="hero2-scrim" />
          <div className="hero2-copy">
            {s.eyebrow && <span className="hero2-eyebrow">{s.eyebrow}</span>}
            <h1>{s.title}</h1>
            {s.subtitle && <p>{s.subtitle.length > 110 ? s.subtitle.slice(0, 108).trimEnd() + "…" : s.subtitle}</p>}
            <button type="button" className="hero2-cta" onClick={onPrimary}>{primaryLabel}</button>
          </div>
          {dots}
        </div>
        {s.linkText && s.linkUrl && (
          <a className="hero2-link" href={s.linkUrl} target="_blank" rel="noopener noreferrer">{s.linkText}</a>
        )}
      </section>
    );
  }

  /* ------------------------------ desktop ------------------------------ */
  return (
    <section className="hero2 desktop" aria-label="MedAI highlights" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      <div key={"d" + i} className="hero2-copy slidefade">
        {s.eyebrow && <span className="hero2-eyebrow">{s.eyebrow}</span>}
        <h1>{s.title}</h1>
        {s.subtitle && <p>{s.subtitle}</p>}
        {!!s.pills?.length && <div className="hero2-pills">{s.pills.slice(0, 4).map((p) => <span key={p}>{p}</span>)}</div>}
        <div className="hero2-actions">
          <button type="button" className="hero2-cta" onClick={onPrimary}>{primaryLabel}</button>
          {s.linkText && s.linkUrl && <a className="hero2-ghost" href={s.linkUrl} target="_blank" rel="noopener noreferrer">{s.linkText}</a>}
        </div>
        {dots}
      </div>
      <div className="hero2-art">
        <img key={"a" + i} src={art} alt="" className="hero2-img slidefade" />
        <div className="hero2-badge"><b>Doctor-led</b><span>Every report reviewed by a clinician</span></div>
        <div className="hero2-badge low"><b>Private</b><span>Your files stay in your account</span></div>
      </div>
    </section>
  );
}
