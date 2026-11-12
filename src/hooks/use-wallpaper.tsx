import { useEffect, useState } from "react";
import { isCustomWallpaperFileAllowed, readCachedWallpaper, saveCustomWallpaper, saveWallpaperPreset, type CachedWallpaper } from "@/lib/wallpaper-cache";

/**
 * Wallpaper system — drives `--wallpaper` and adaptive `--glass-tint`
 * on <html>, so every glass surface inherits a subtle wash of the current
 * background (Apple Control Center behavior).
 */
export type WallpaperPreset = {
  id: string;
  label: string;
  /** CSS `background` value applied to `.pace-bg` via `--wallpaper` */
  css: string;
  cssDark?: string;
  /** rgb triplet for adaptive glass tint (light mode) */
  tint: string;
  tintDark?: string;
  /** subtle preview swatch */
  swatch: string;
};

export const WALLPAPERS: WallpaperPreset[] = [
  {
    id: "aurora",
    label: "Aurora",
    css: `
      radial-gradient(1200px 700px at -10% -10%, oklch(0.96 0.06 60 / 0.55), transparent 60%),
      radial-gradient(1000px 700px at 110% 10%, oklch(0.94 0.05 240 / 0.5), transparent 60%),
      radial-gradient(900px 800px at 50% 120%, oklch(0.95 0.04 200 / 0.4), transparent 60%),
      linear-gradient(135deg, oklch(0.985 0.012 60) 0%, oklch(0.99 0.005 247) 50%, oklch(0.97 0.02 240) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at -10% -10%, oklch(0.28 0.08 250 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 110% 10%, oklch(0.22 0.09 260 / 0.55), transparent 60%),
      radial-gradient(900px 800px at 50% 120%, oklch(0.2 0.06 240 / 0.5), transparent 60%),
      linear-gradient(135deg, oklch(0.13 0.02 260) 0%, oklch(0.14 0.03 255) 50%, oklch(0.16 0.05 245) 100%)`,
    tint: "255 255 255",
    tintDark: "22 26 40",
    swatch: "linear-gradient(135deg, #fef3c7, #dbeafe, #a5f3fc)",
  },
  {
    id: "ocean",
    label: "Océan",
    css: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.88 0.08 220 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 100% 40%, oklch(0.85 0.1 200 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.96 0.02 220) 0%, oklch(0.9 0.05 210) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.32 0.12 220 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 100% 40%, oklch(0.26 0.1 200 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.11 0.03 220) 0%, oklch(0.14 0.06 210) 100%)`,
    tint: "220 234 245",
    tintDark: "18 32 48",
    swatch: "linear-gradient(135deg, #bae6fd, #7dd3fc, #0ea5e9)",
  },
  {
    id: "sunset",
    label: "Coucher",
    css: `
      radial-gradient(1000px 700px at -10% 10%, oklch(0.9 0.14 30 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 100% 100%, oklch(0.85 0.16 350 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.03 40) 0%, oklch(0.92 0.08 20) 100%)`,
    cssDark: `
      radial-gradient(1000px 700px at -10% 10%, oklch(0.35 0.16 30 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 100% 100%, oklch(0.3 0.16 350 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.14 0.04 20) 0%, oklch(0.16 0.06 350) 100%)`,
    tint: "252 232 220",
    tintDark: "40 22 32",
    swatch: "linear-gradient(135deg, #fed7aa, #fda4af, #f43f5e)",
  },
  {
    id: "forest",
    label: "Forêt",
    css: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.9 0.08 155 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 100% 60%, oklch(0.86 0.1 170 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.02 155) 0%, oklch(0.92 0.05 160) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.32 0.1 155 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 100% 60%, oklch(0.26 0.09 170 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.12 0.03 155) 0%, oklch(0.14 0.05 165) 100%)`,
    tint: "224 240 224",
    tintDark: "18 34 26",
    swatch: "linear-gradient(135deg, #bbf7d0, #86efac, #059669)",
  },
  {
    id: "graphite",
    label: "Graphite",
    css: `
      radial-gradient(1200px 700px at 30% 0%, oklch(0.95 0.005 260 / 0.7), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.003 260) 0%, oklch(0.92 0.006 250) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at 30% 0%, oklch(0.22 0.01 260 / 0.7), transparent 60%),
      linear-gradient(160deg, oklch(0.1 0.005 260) 0%, oklch(0.13 0.008 255) 100%)`,
    tint: "244 244 246",
    tintDark: "20 22 26",
    swatch: "linear-gradient(135deg, #e5e7eb, #9ca3af, #374151)",
  },
  {
    id: "orchid",
    label: "Orchidée",
    css: `
      radial-gradient(1000px 700px at 10% 0%, oklch(0.9 0.1 300 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 90% 100%, oklch(0.88 0.12 280 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.03 290) 0%, oklch(0.93 0.06 295) 100%)`,
    cssDark: `
      radial-gradient(1000px 700px at 10% 0%, oklch(0.32 0.14 300 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 90% 100%, oklch(0.28 0.14 280 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.13 0.05 290) 0%, oklch(0.15 0.07 295) 100%)`,
    tint: "240 226 246",
    tintDark: "32 22 40",
    swatch: "linear-gradient(135deg, #f5d0fe, #d8b4fe, #a855f7)",
  },
];


type CustomWallpaper = { kind: "custom"; url: string };
type WallpaperChoice = { id: string } | CustomWallpaper;
const DEFAULT: WallpaperChoice = { id: "graphite" };
let cachedChoice: WallpaperChoice = DEFAULT;
let cacheLoaded = false;
let cacheLoadPromise: Promise<WallpaperChoice> | null = null;
let cacheRevision = 0;
function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:(image\/[^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;
  try { const binary=atob(match[2].replace(/\s/g,"")); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i); return new Blob([bytes],{type:match[1]}); } catch { return null; }
}
async function migrateLegacyLocalWallpaper(): Promise<CachedWallpaper | null> {
  if(typeof window==="undefined") return null;
  let parsed: unknown;
  try { const raw=window.localStorage.getItem("pace.wallpaper"); if(!raw)return null; parsed=JSON.parse(raw); } catch { return null; }
  try {
    if(parsed&&typeof parsed==="object"&&"id" in parsed&&typeof parsed.id==="string"){await saveWallpaperPreset(parsed.id);window.localStorage.removeItem("pace.wallpaper");return{kind:"preset",id:parsed.id};}
    if(parsed&&typeof parsed==="object"&&"kind" in parsed&&parsed.kind==="custom"&&"dataUrl" in parsed&&typeof parsed.dataUrl==="string"){const blob=dataUrlToBlob(parsed.dataUrl);if(!blob||!isCustomWallpaperFileAllowed(blob))return null;await saveCustomWallpaper(blob);window.localStorage.removeItem("pace.wallpaper");return{kind:"custom",blob};}
  } catch { /* Keep the legacy local copy if IndexedDB migration fails. */ }
  return null;
}
export function readWallpaperChoice(): WallpaperChoice { return cachedChoice; }
export function loadWallpaperChoice(): Promise<WallpaperChoice> {
  if(cacheLoaded)return Promise.resolve(cachedChoice);
  if(cacheLoadPromise)return cacheLoadPromise;
  const revisionAtStart=cacheRevision;
  cacheLoadPromise=(async()=>{let cached=await readCachedWallpaper();if(!cached)cached=await migrateLegacyLocalWallpaper();if(revisionAtStart!==cacheRevision)return cachedChoice;if(cached?.kind==="custom")cachedChoice={kind:"custom",url:URL.createObjectURL(cached.blob)};else if(cached?.kind==="preset")cachedChoice={id:cached.id};else cachedChoice=DEFAULT;cacheLoaded=true;applyWallpaper(cachedChoice);return cachedChoice;})().catch((error)=>{cacheLoadPromise=null;throw error;});
  return cacheLoadPromise;
}
export function useWallpaper() {
  const [choice,setChoice]=useState<WallpaperChoice>(()=>readWallpaperChoice());
  useEffect(()=>{let active=true;void loadWallpaperChoice().then((next)=>{if(active)setChoice(next);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{applyWallpaper(choice);},[choice]);
  const set=async(id:string)=>{const normalizedId=WALLPAPERS.some((preset)=>preset.id===id)?id:"graphite";await saveWallpaperPreset(normalizedId);cacheRevision++;if("kind" in cachedChoice&&cachedChoice.kind==="custom")URL.revokeObjectURL(cachedChoice.url);const next={id:normalizedId};cachedChoice=next;cacheLoaded=true;cacheLoadPromise=Promise.resolve(next);setChoice(next);};
  const setCustom=async(file:Blob)=>{if(!isCustomWallpaperFileAllowed(file))throw new Error("Image invalide ou supérieure à 20 Mo.");await saveCustomWallpaper(file);cacheRevision++;if("kind" in cachedChoice&&cachedChoice.kind==="custom")URL.revokeObjectURL(cachedChoice.url);const next={kind:"custom" as const,url:URL.createObjectURL(file)};cachedChoice=next;cacheLoaded=true;cacheLoadPromise=Promise.resolve(next);setChoice(next);};
  const reset=()=>set("graphite");
  return {choice,presets:WALLPAPERS,set,setCustom,reset};
}
export function applyWallpaper(choice: WallpaperChoice) {
  if(typeof document==="undefined")return;
  const root=document.documentElement,isDark=root.classList.contains("dark");
  if("kind" in choice&&choice.kind==="custom"){
    root.style.setProperty("--wallpaper",'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.15)), url("'+choice.url+'") center/cover no-repeat');
    root.style.setProperty("--glass-tint",isDark?"10 14 22":"255 255 255");
    root.style.setProperty("--glass-tint-base",isDark?"0.34":"0.2");
    root.setAttribute("data-wallpaper","custom");return;
  }
  const presetId = "id" in choice ? choice.id : "graphite";
  const preset = WALLPAPERS.find((w) => w.id === presetId) ?? WALLPAPERS[0];
  const css=(isDark&&preset.cssDark)?preset.cssDark:preset.css;
  const tint=(isDark&&preset.tintDark)?preset.tintDark:preset.tint;
  root.style.setProperty("--wallpaper",css.trim());
  root.style.setProperty("--glass-tint",tint);
  root.style.setProperty("--glass-tint-base",isDark?"0.26":"0.13");
  root.setAttribute("data-wallpaper",preset.id);
}
