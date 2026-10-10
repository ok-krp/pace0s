/**
 * Assainisseur HTML en liste blanche pour les notes riches.
 * DOMParser analyse le document comme contenu inerte avant toute insertion dans l'éditeur.
 */
const ALLOWED_TAGS = new Set([
  "A", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI",
  "H1", "H2", "H3", "BLOCKQUOTE", "FONT", "INPUT", "CODE", "PRE", "HR",
]);
const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "NOSCRIPT", "LINK", "META", "FORM", "TEXTAREA", "SELECT", "BUTTON"]);
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration",
  "text-align", "display", "align-items", "gap", "margin", "margin-top", "margin-bottom",
]);
const SAFE_STYLE_VALUE = /^[a-zA-Z0-9\s#%.,'"()_-]*$/;

function sanitizeStyle(style: string): string {
  return style.split(";").map((decl) => decl.trim()).filter(Boolean).map((decl) => {
    const idx = decl.indexOf(":");
    if (idx < 1) return "";
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop) || !SAFE_STYLE_VALUE.test(value) || /url\s*\(|expression|javascript|@import/i.test(value)) return "";
    return `${prop}:${value}`;
  }).filter(Boolean).join(";");
}

export function isSafeLinkHref(href: string): boolean {
  try {
    const url = new URL(href, "https://pace.invalid");
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function cleanNode(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) { node.removeChild(child); continue; }
    const el = child as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) { node.removeChild(el); continue; }
    if (!ALLOWED_TAGS.has(tag)) {
      cleanNode(el);
      while (el.firstChild) node.insertBefore(el.firstChild, el);
      node.removeChild(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      let keep = false;
      if (name === "style") {
        const safe = sanitizeStyle(value);
        if (safe) { el.setAttribute("style", safe); keep = true; }
      } else if (name === "class") {
        const safe = value.split(/\s+/).filter((c) => c === "pace-check").join(" ");
        if (safe) { el.setAttribute("class", safe); keep = true; }
      } else if (name === "href" && tag === "A") keep = isSafeLinkHref(value);
      else if (name === "contenteditable" && tag === "SPAN") keep = value === "true";
      else if (tag === "INPUT" && name === "type") keep = value.toLowerCase() === "checkbox";
      else if (tag === "INPUT" && name === "checked") keep = true;
      else if (tag === "FONT" && ["color", "size", "face"].includes(name)) keep = SAFE_STYLE_VALUE.test(value);
      if (!keep) el.removeAttribute(attr.name);
    }
    if (tag === "INPUT" && el.getAttribute("type") !== "checkbox") { node.removeChild(el); continue; }
    if (tag === "A") { el.setAttribute("rel", "noopener noreferrer nofollow"); el.setAttribute("target", "_blank"); }
    cleanNode(el);
  }
}

const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);

/** Retourne du HTML sûr, destiné à être injecté dans l'éditeur de notes. */
export function sanitizeNoteHtml(html: string): string {
  if (typeof html !== "string" || !html) return "";
  if (typeof DOMParser === "undefined") return escapeText(html);
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

export function htmlToPlainText(html: string): string {
  if (typeof html !== "string" || !html) return "";
  if (typeof DOMParser === "undefined") return html.trim();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}
