import { useEffect } from "react";

/**
 * Filtre SVG de réfraction « verre liquide » (déformation + aberration chromatique par canal).
 * Utilisé uniquement par le thème Liquid, sur Chromium (le seul moteur qui accepte
 * un filtre SVG dans backdrop-filter). Ailleurs : repli sur flou + reflets CSS.
 */
export function LiquidGlassDefs() {
  useEffect(() => {
    const ua = navigator.userAgent;
    const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/OPR\/|Firefox\//.test(ua);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    if (chromium && !reduced) root.dataset.lgRefract = "1";
    return () => { delete root.dataset.lgRefract; };
  }, []);
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", pointerEvents: "none" }}>
      <defs>
        <filter id="pace-liquid-refract" x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.010" numOctaves="2" seed="11" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2.2" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="34" xChannelSelector="R" yChannelSelector="G" result="dispR" />
          <feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chR" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="27" xChannelSelector="R" yChannelSelector="G" result="dispG" />
          <feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chG" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="20" xChannelSelector="R" yChannelSelector="G" result="dispB" />
          <feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chB" />
          <feBlend in="chR" in2="chG" mode="screen" result="rg" />
          <feBlend in="rg" in2="chB" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}
