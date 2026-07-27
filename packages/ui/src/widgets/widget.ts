import { Disposable } from "./event";

export class Widget extends Disposable {
  constructor(protected readonly root: HTMLElement) {
    super();
  }

  protected listen<K extends keyof GlobalEventHandlersEventMap>(
    element: EventTarget,
    type: K,
    listener: (event: GlobalEventHandlersEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    element.addEventListener(type, listener as EventListener, options);
    this._register({
      dispose: () =>
        element.removeEventListener(type, listener as EventListener, options),
    });
  }
}

export function append(
  parent: HTMLElement,
  ...children: Array<Node | null | undefined>
) {
  parent.append(...children.filter((child): child is Node => Boolean(child)));
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: {
    ariaLabel?: string;
    className?: string;
    role?: string;
    textContent?: string;
  } = {},
) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.role) element.setAttribute("role", options.role);
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.textContent !== undefined) {
    element.textContent = options.textContent;
  }
  return element;
}
