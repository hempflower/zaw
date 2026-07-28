import DOMPurify from "dompurify";
import { marked } from "marked";

const renderVersions = new WeakMap<HTMLElement, number>();
let mermaidInitialized = false;

/** Renders sanitized GFM and upgrades fenced Mermaid blocks asynchronously. */
export function renderMarkdown(root: HTMLElement, source: string): void {
  const version = (renderVersions.get(root) ?? 0) + 1;
  renderVersions.set(root, version);
  const parsed = marked.parse(source, { async: false, gfm: true });
  root.innerHTML = DOMPurify.sanitize(parsed.trim());
  sanitizeDOM(root);
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      node.remove();
    }
  }
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  for (const code of root.querySelectorAll<HTMLElement>(
    "pre > code.language-mermaid",
  )) {
    void renderMermaid(code, root, version);
  }
}

function sanitizeDOM(root: HTMLElement, allowGeneratedStyles = false): void {
  root
    .querySelectorAll(
      `script, iframe, object, embed, link, meta${allowGeneratedStyles ? "" : ", style"}`,
    )
    .forEach((element) => element.remove());
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
      if (
        ["href", "xlink:href"].includes(attribute.name.toLowerCase()) &&
        /^\s*javascript:/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

async function renderMermaid(
  code: HTMLElement,
  root: HTMLElement,
  version: number,
): Promise<void> {
  const source = code.textContent ?? "";
  const block = code.parentElement;
  if (!block || !source.trim()) return;
  try {
    const { default: mermaid } = await import("mermaid");
    if (!mermaidInitialized) {
      mermaid.initialize({
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: "dark",
        flowchart: { htmlLabels: false },
      });
      mermaidInitialized = true;
    }
    const id = `zaw-mermaid-${crypto.randomUUID()}`;
    const { svg } = await mermaid.render(id, source);
    if (renderVersions.get(root) !== version || !block.parentElement) return;
    const figure = document.createElement("figure");
    figure.className = "markdown-mermaid";
    figure.setAttribute("aria-label", "Mermaid diagram");
    // Mermaid's strict mode encodes diagram HTML. Preserve its foreignObject
    // labels, then apply the same defensive DOM checks used for Markdown.
    figure.innerHTML = svg;
    sanitizeDOM(figure, true);
    block.replaceWith(figure);
  } catch {
    // Keep the source code visible when an incomplete or invalid diagram streams in.
    block.classList.add("markdown-mermaid-error");
  }
}
