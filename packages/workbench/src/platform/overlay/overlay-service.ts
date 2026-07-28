import { type IDisposable } from "@zaw/ui";
import { injectable } from "inversify";

export const IOverlayService = Symbol.for("IOverlayService");

export interface IOverlayService {
  activateModal(root: HTMLElement, onEscape: () => void): IDisposable;
}

/** Owns generic modal policy: inert siblings, focus containment and pointer geometry. */
@injectable()
export class OverlayService implements IOverlayService {
  activateModal(root: HTMLElement, onEscape: () => void): IDisposable {
    root.classList.add("zaw-floating-window");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.tabIndex = -1;
    root.style.left ||= "max(24px, 12vw)";
    root.style.top ||= "max(24px, 10vh)";
    root.style.width ||= "min(760px, calc(100vw - 48px))";
    root.style.height ||= "min(620px, calc(100vh - 48px))";
    const resize = document.createElement("div");
    resize.className = "zaw-floating-resize se";
    root.append(resize);
    const inerted = new Map<HTMLElement, boolean>();
    const applyInert = () => {
      const shell = root.closest(".zaw-workbench");
      if (!shell) return;
      for (const child of Array.from(shell.children)) {
        if (child.contains(root) || !(child instanceof HTMLElement)) continue;
        inerted.set(child, child.inert);
        child.inert = true;
      }
    };
    queueMicrotask(applyInert);
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), " +
            "select:not([disabled]), textarea:not([disabled]), " +
            "[tabindex]:not([tabindex='-1'])",
        ),
      );
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const current = document.activeElement;
      const index = items.indexOf(current as HTMLElement);
      if (event.shiftKey && (index <= 0 || !root.contains(current))) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const mode = target.closest("[data-overlay-drag]")
        ? "drag"
        : target === resize
          ? "resize"
          : undefined;
      if (!mode) return;
      const initial = root.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const move = (next: PointerEvent) => {
        if (mode === "drag") {
          root.style.left = `${Math.max(0, initial.left + next.clientX - startX)}px`;
          root.style.top = `${Math.max(0, initial.top + next.clientY - startY)}px`;
        } else {
          root.style.width = `${Math.max(360, initial.width + next.clientX - startX)}px`;
          root.style.height = `${Math.max(260, initial.height + next.clientY - startY)}px`;
        }
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
      event.preventDefault();
    };
    root.addEventListener("keydown", keydown);
    root.addEventListener("pointerdown", pointer);
    queueMicrotask(() => root.focus());
    return {
      dispose: () => {
        root.removeEventListener("keydown", keydown);
        root.removeEventListener("pointerdown", pointer);
        resize.remove();
        for (const [element, inert] of inerted) element.inert = inert;
      },
    };
  }
}
