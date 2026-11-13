// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Sponsored cards / ads — kept in its own module so the rules are testable.
//
// A medical app must never show a misleading ad:
//   * everything is labelled "Sponsored"/"Ad" by the client
//   * ads never appear inside a report, prescription, chat answer or call screen
//   * the administrator can switch the whole feature off
//   * clicks are counted in aggregate only (no user id, no cookies)
import { z } from "zod";
import { Setting } from "./models.js";

export const adSchema=z.object({
  id:z.string().trim().max(40).optional().default(""),
  title:z.string().trim().min(1).max(90),
  body:z.string().trim().max(220).optional().default(""),
  sponsor:z.string().trim().max(60).optional().default(""),
  ctaText:z.string().trim().max(30).optional().default(""),
  ctaUrl:z.string().trim().max(300).refine(v=>!v||/^https?:\/\//i.test(v),"Link must start with http:// or https://").optional().default(""),
  image:z.string().max(600_000).refine(v=>!v||/^data:image\/(png|jpeg|webp);base64,/.test(v),"Image must be PNG, JPG or WEBP").optional().default(""),
  placement:z.enum(["all","home","dashboard","chat"]).optional().default("all"),
  active:z.boolean().optional().default(true),
  priority:z.number().int().min(0).max(99).optional().default(0)
});
export const adsSchema=z.object({
  enabled:z.boolean().default(true),
  note:z.string().trim().max(200).optional().default(""),
  items:z.array(adSchema).max(20).default([])
});
export const ADS_DEFAULT={enabled:true,note:"",items:[]};
export async function loadAds(){
  const s=await Setting.findOne({key:"ads"}).lean();
  const v=s?.value||{};
  const parsed=adsSchema.safeParse({enabled:v.enabled!==false,note:v.note||"",items:Array.isArray(v.items)?v.items:[]});
  if(!parsed.success)return ADS_DEFAULT;
  const clicks=v.clicks&&typeof v.clicks==="object"?v.clicks:{};
  return {...parsed.data,clicks};
}
/** Public list: only what that screen is allowed to show. */
export function adsForScreen(ads,placement,limit=2){
  if(!ads.enabled)return [];
  const now=Date.now();
  return (ads.items||[])
    .filter(a=>a.active!==false&&(!a.placement||a.placement==="all"||a.placement===placement))
    .sort((a,b)=>(b.priority||0)-(a.priority||0))
    .slice(0,limit)
    .map(a=>({id:a.id||a.title,title:a.title,body:a.body,sponsor:a.sponsor,ctaText:a.ctaText,ctaUrl:a.ctaUrl,image:a.image}));
}

/**
 * The cards a given screen may show.
 * @param {object} ads loaded settings
 * @param {"home"|"dashboard"|"chat"} placement
 * @param {number} limit max cards (1..3)
 */
export function cardsForScreen(ads, placement, limit = 2) {
  return adsForScreen(ads, placement, limit);
}

export async function recordAdClick(id) {
  const safe = String(id || "").slice(0, 40);
  if (!safe) return false;
  const ads = await loadAds();
  if (!ads.items.some((a) => (a.id || a.title) === safe)) return false;
  const clicks = { ...(ads.clicks || {}) };
  clicks[safe] = Math.min(Number(clicks[safe] || 0) + 1, 9_999_999);
  await Setting.findOneAndUpdate({ key: "ads" }, { $set: { "value.clicks": clicks } });
  return true;
}
