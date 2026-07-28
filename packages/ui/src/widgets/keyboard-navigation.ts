export type RovingOrientation = "horizontal" | "vertical" | "both";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getFocusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => element.getAttribute("aria-disabled") !== "true");
}

export function setRovingTabStop(
  elements: readonly HTMLElement[],
  preferred?: HTMLElement,
): HTMLElement | undefined {
  const enabled = elements.filter(
    (element) =>
      !(element instanceof HTMLButtonElement && element.disabled) &&
      element.getAttribute("aria-disabled") !== "true",
  );
  const active =
    (preferred && enabled.includes(preferred) ? preferred : undefined) ??
    enabled.find(
      (element) => element.getAttribute("aria-selected") === "true",
    ) ??
    enabled[0];
  for (const element of elements)
    element.tabIndex = element === active ? 0 : -1;
  return active;
}

export function moveRovingFocus(
  event: KeyboardEvent,
  elements: readonly HTMLElement[],
  orientation: RovingOrientation = "vertical",
): boolean {
  const enabled = elements.filter(
    (element) =>
      !(element instanceof HTMLButtonElement && element.disabled) &&
      element.getAttribute("aria-disabled") !== "true",
  );
  if (enabled.length === 0) return false;

  const previous =
    event.key === "ArrowUp" ||
    (orientation !== "vertical" && event.key === "ArrowLeft");
  const next =
    event.key === "ArrowDown" ||
    (orientation !== "vertical" && event.key === "ArrowRight");
  if (
    (!previous && !next && event.key !== "Home" && event.key !== "End") ||
    (orientation === "horizontal" &&
      (event.key === "ArrowUp" || event.key === "ArrowDown"))
  ) {
    return false;
  }

  const current = enabled.indexOf(document.activeElement as HTMLElement);
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabled.length - 1
        : previous
          ? (current <= 0 ? enabled.length : current) - 1
          : (current + 1) % enabled.length;
  const target = enabled[index];
  setRovingTabStop(elements, target);
  target.focus();
  event.preventDefault();
  event.stopPropagation();
  return true;
}
