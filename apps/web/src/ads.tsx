// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Sponsored cards. Rules that keep this honest in a medical app:
//  * always labelled "Sponsored" / "Ad"
//  * never inside a clinical result, prescription or chat answer
//  * one per screen, and the visitor can hide all of them
import { useEffect, useState } from "react";
import { makeApi } from "./api";

const HIDE_KEY = "medai_hide_ads";
const PREF_EVENT = "medai-ads-preference";

export function adsHidden(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
}

export function setAdsHidden(hidden: boolean) {
  try { hidden ? localStorage.setItem(HIDE_KEY, "1") : localStorage.removeItem(HIDE_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event(PREF_EVENT));
}

export function useAdsHidden(): boolean {
  const [hidden, setHidden] = useState(adsHidden);
  useEffect(() => {
    const update = () => setHidden(adsHidden());
    window.addEventListener(PREF_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(PREF_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return hidden;
}

type Ad = { id: string; title: string; body?: string; sponsor?: string; ctaText?: string; ctaUrl?: string; image?: string };

/**
 * One sponsored card for a screen. Renders nothing when admin switched ads off,
 * when this screen has no active card, or when the visitor hid ads.
 */
export function AdSlot({ placement = "home", variant }: { placement?: "home" | "dashboard" | "chat"; variant?: "wide" | "rail" }) {
  const hidden = useAdsHidden();
  const [ads, setAds] = useState<Ad[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    makeApi("")("/ads?placement=" + placement + "&limit=1")
      .then((d: any) => { if (alive) { setAds(d.ads || []); setNote(d.note || ""); } })
      .catch(() => { /* no ads is not an error */ });
    return () => { alive = false; };
  }, [placement, hidden]);

  if (hidden || !ads.length) return null;
  const ad = ads[0];
  const wide = variant === "wide";

  function onOpen() {
    try { makeApi("")("/ads/" + encodeURIComponent(ad.id) + "/click", { method: "POST", body: "{}" }); } catch { /* counting is best effort */ }
  }

  return (
    <aside className={"adcard" + (wide ? " wide" : " rail")} aria-label="Sponsored">
      <div className="adhead"><span className="adtag">Ad</span>{ad.sponsor && <span className="adsponsor">{ad.sponsor}</span>}</div>
      {ad.image && <img className="adimg" src={ad.image} alt="" loading="lazy" />}
      <b className="adtitle">{ad.title}</b>
      {ad.body && <p className="adbody">{ad.body}</p>}
      <div className="adfoot">
        {ad.ctaUrl && ad.ctaText && <a className="adcta" href={ad.ctaUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={onOpen}>{ad.ctaText}</a>}
        <button type="button" className="adhide" onClick={() => setAdsHidden(true)}>Hide ads</button>
      </div>
      {note && <p className="adnote">{note}</p>}
    </aside>
  );
}
