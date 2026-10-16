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
  if (!href.trim()) return false;
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

function serializeSafeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (!ALLOWED_TAGS.has(tag)) {
    return Array.from(el.childNodes).map(serializeSafeNode).join("");
  }

  const attrs: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name === "style") {
      const safe = sanitizeStyle(value);
      if (safe) attrs.push(`style="${escapeText(safe)}"`);
    } else if (name === "class") {
      const safe = value.split(/\s+/).filter((item) => item === "pace-check").join(" ");
      if (safe) attrs.push(`class="${escapeText(safe)}"`);
    } else if (name === "href" && tag === "A" && isSafeLinkHref(value)) {
      attrs.push(`href="${escapeText(value)}"`);
    } else if (name === "contenteditable" && tag === "SPAN" && value === "true") {
      attrs.push('contenteditable="true"');
    } else if (tag === "INPUT" && name === "type" && value.toLowerCase() === "checkbox") {
      attrs.push('type="checkbox"');
    } else if (tag === "INPUT" && name === "checked") {
      attrs.push('checked=""');
    } else if (tag === "FONT" && ["color", "size", "face"].includes(name) && SAFE_STYLE_VALUE.test(value)) {
      attrs.push(`${name}="${escapeText(value)}"`);
    }
  }
  if (tag === "A" && isSafeLinkHref(el.getAttribute("href") ?? "")) {
    attrs.push('rel="noopener noreferrer nofollow"', 'target="_blank"');
  }
  const open = `<${tag.toLowerCase()}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  if (tag === "INPUT" || tag === "BR" || tag === "HR") return open;
  return open + Array.from(el.childNodes).map(serializeSafeNode).join("") + `</${tag.toLowerCase()}>`;
}

/** Builds a sanitized DOM fragment without routing untrusted text through an innerHTML sink. */
export function sanitizeNoteFragment(html: string, ownerDocument: Document): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  if (typeof html !== "string" || !html) return fragment;
  if (typeof DOMParser === "undefined") {
    fragment.appendChild(ownerDocument.createTextNode(html));
    return fragment;
  }

  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  cleanNode(doc.body);
  while (doc.body.firstChild) {
    fragment.appendChild(ownerDocument.importNode(doc.body.firstChild, true));
    doc.body.removeChild(doc.body.firstChild);
  }
  return fragment;
}

/** Retourne du HTML sûr, destiné à être stocké dans les notes riches. */
export function sanitizeNoteHtml(html: string): string {
  if (typeof html !== "string" || !html) return "";
  if (typeof DOMParser === "undefined") return escapeText(html);
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  cleanNode(doc.body);
  return Array.from(doc.body.childNodes).map(serializeSafeNode).join("");
}

export function htmlToPlainText(html: string): string {
  if (typeof html !== "string" || !html) return "";
  if (typeof DOMParser === "undefined") return html.trim();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}
