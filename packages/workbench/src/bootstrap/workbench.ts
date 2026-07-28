import { Disposable, type IDisposable } from "@zaw/ui";
import { inject, injectable } from "inversify";
import {
  ILifecycleService,
  LifecyclePhase,
} from "../platform/lifecycle/lifecycle";
import {
  IWorkbenchViewHost,
  WorkbenchViewHost,
} from "../services/workbench-view-host";
import { IWorkbenchLayoutService, Part } from "../workbench/layout/layout";
import { createLayoutSash } from "../workbench/layout/layout-sash";

export const WorkbenchRoot = Symbol.for("WorkbenchRoot");

/**
 * The workbench owns only stable layout roots and application lifecycle.
 * Feature state and behaviour are contributed through services and views.
 */
@injectable()
export class Workbench extends Disposable {
  private started = false;
  private eventuallyTimer: ReturnType<typeof setTimeout> | undefined;
  private shell: HTMLElement | undefined;
  private layoutListener: IDisposable | undefined;
  private sizeListener: IDisposable | undefined;
  private resizeListener: (() => void) | undefined;
  private keydownListener: ((event: KeyboardEvent) => void) | undefined;
  private rejectionListener:
    | ((event: PromiseRejectionEvent) => void)
    | undefined;

  constructor(
    @inject(WorkbenchRoot) private readonly root: HTMLElement,
    @inject(ILifecycleService) private readonly lifecycle: ILifecycleService,
    @inject(IWorkbenchLayoutService)
    private readonly layout: IWorkbenchLayoutService,
    @inject(IWorkbenchViewHost) private readonly views: WorkbenchViewHost,
  ) {
    super();
    this._register({ dispose: () => this.stop() });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window !== "undefined") {
      this.rejectionListener = (event) => {
        console.error("Unhandled workbench rejection", event.reason);
        event.preventDefault();
      };
      window.addEventListener("unhandledrejection", this.rejectionListener);
    }
    const shell = (this.shell = document.createElement("main"));
    shell.className = "zaw-workbench";
    const layoutMode = this.layoutMode();
    shell.dataset.layout = layoutMode;
    shell.dataset.platform = layoutMode === "desktop" ? "desktop" : "mobile";
    for (const part of [
      Part.Titlebar,
      Part.Sidebar,
      Part.Primary,
      Part.AuxiliaryBar,
      Part.Panel,
      Part.Overlay,
    ]) {
      const partRoot = this.layout.getPartRoot(part);
      shell.append(partRoot);
      this.views.mount(part, partRoot);
    }
    const mobileBackdrop = document.createElement("button");
    mobileBackdrop.type = "button";
    mobileBackdrop.className = "agent-mobile-drawer-backdrop";
    mobileBackdrop.setAttribute("aria-label", "Close overlay");
    mobileBackdrop.addEventListener("click", () => this.closeMobileOverlay());
    shell.append(mobileBackdrop);
    shell.append(
      createLayoutSash({
        currentSize: () => this.layout.sidebarWidth,
        kind: "sidebar",
        resize: (size) => this.resizeSidebar(size),
      }),
      createLayoutSash({
        currentSize: () => this.layout.auxiliaryBarWidth,
        kind: "auxiliary",
        resize: (size) => this.resizeAuxiliary(size),
      }),
      createLayoutSash({
        currentSize: () => this.layout.panelHeight,
        kind: "panel",
        resize: (size) => this.resizePanel(size),
      }),
    );
    this.applyLayoutPolicy();
    this.syncPartVisibility();
    this.layoutListener = this.layout.onDidTogglePart(({ part, visible }) =>
      this.handlePartVisibility(part, visible),
    );
    this.sizeListener = this.layout.onDidChangeSize(() =>
      this.syncPartVisibility(),
    );
    if (typeof window !== "undefined") {
      this.resizeListener = () => this.applyLayoutPolicy();
      window.addEventListener("resize", this.resizeListener);
      this.keydownListener = (event) => {
        if (event.key === "Escape" && this.hasMobileOverlay())
          this.closeMobileOverlay();
      };
      window.addEventListener("keydown", this.keydownListener);
    }
    this.root.replaceChildren(shell);
    this.lifecycle.setPhase(LifecyclePhase.Ready);
    queueMicrotask(() => {
      if (this.started) this.lifecycle.setPhase(LifecyclePhase.Restored);
    });
    this.eventuallyTimer = setTimeout(() => {
      if (this.started) this.lifecycle.setPhase(LifecyclePhase.Eventually);
    }, 0);
  }

  private stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.eventuallyTimer) clearTimeout(this.eventuallyTimer);
    if (this.rejectionListener && typeof window !== "undefined") {
      window.removeEventListener("unhandledrejection", this.rejectionListener);
      this.rejectionListener = undefined;
    }
    this.lifecycle.shutdown();
    this.layoutListener?.dispose();
    this.layoutListener = undefined;
    this.sizeListener?.dispose();
    this.sizeListener = undefined;
    if (this.resizeListener && typeof window !== "undefined") {
      window.removeEventListener("resize", this.resizeListener);
      this.resizeListener = undefined;
    }
    if (this.keydownListener && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keydownListener);
      this.keydownListener = undefined;
    }
    this.root.replaceChildren();
    this.shell = undefined;
  }

  private syncPartVisibility(): void {
    this.shell?.style.setProperty(
      "--zaw-left-panel-width",
      `${this.layout.sidebarWidth}px`,
    );
    this.shell?.style.setProperty(
      "--zaw-right-panel-width",
      `${this.layout.auxiliaryBarWidth}px`,
    );
    this.shell?.style.setProperty(
      "--zaw-bottom-panel-height",
      `${this.layout.panelHeight}px`,
    );
    this.shell?.classList.toggle(
      "left-panel-hidden",
      !this.layout.isVisible(Part.Sidebar),
    );
    this.shell?.classList.toggle(
      "right-panel-hidden",
      !this.layout.isVisible(Part.AuxiliaryBar),
    );
    this.shell?.classList.toggle(
      "bottom-panel-hidden",
      !this.layout.isVisible(Part.Panel),
    );
    const mobile = this.isMobileLayout();
    for (const part of [Part.Sidebar, Part.AuxiliaryBar, Part.Panel]) {
      const root = this.layout.getPartRoot(part);
      const hidden = !this.layout.isVisible(part);
      root.inert = hidden;
      root.setAttribute("aria-hidden", String(hidden));
    }
    this.shell?.classList.toggle(
      "mobile-overlay-open",
      mobile && this.hasMobileOverlay(),
    );
    for (const [name, value] of [
      ["sidebar", this.layout.sidebarWidth],
      ["auxiliary", this.layout.auxiliaryBarWidth],
      ["panel", this.layout.panelHeight],
    ] as const)
      this.shell
        ?.querySelector(`[data-sash="${name}"]`)
        ?.setAttribute("aria-valuenow", String(Math.round(value)));
  }

  private handlePartVisibility(part: Part, visible: boolean): void {
    if (this.isMobileLayout() && visible) {
      if (part === Part.Sidebar && this.layout.isVisible(Part.AuxiliaryBar))
        this.layout.setAutoHidden(Part.AuxiliaryBar, true, "mobile-overlay");
      else if (
        part === Part.AuxiliaryBar &&
        this.layout.isVisible(Part.Sidebar)
      )
        this.layout.setAutoHidden(Part.Sidebar, true, "mobile-overlay");
    }
    this.syncPartVisibility();
  }

  private hasMobileOverlay(): boolean {
    return (
      this.layout.isVisible(Part.Sidebar) ||
      this.layout.isVisible(Part.AuxiliaryBar) ||
      this.layout.isVisible(Part.Panel)
    );
  }

  private closeMobileOverlay(): void {
    if (!this.isMobileLayout()) return;
    for (const part of [Part.Sidebar, Part.AuxiliaryBar, Part.Panel]) {
      if (this.layout.isVisible(part))
        this.layout.setAutoHidden(part, true, "mobile-overlay");
    }
  }

  private resizeSidebar(width: number): void {
    if (width < 270) {
      this.layout.setVisible(Part.Sidebar, false);
      return;
    }
    this.layout.setSidebarWidth(width);
  }

  private resizeAuxiliary(width: number): void {
    if (width < 270) {
      this.layout.setVisible(Part.AuxiliaryBar, false);
      return;
    }
    this.layout.setAuxiliaryBarWidth(width);
  }

  private resizePanel(height: number): void {
    if (height < 77) {
      this.layout.setVisible(Part.Panel, false);
      return;
    }
    this.layout.setPanelHeight(height);
  }

  private isMobilePlatform(): boolean {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  private isMobileLayout(): boolean {
    return this.shell?.dataset.platform === "mobile";
  }

  private layoutMode(): "desktop" | "phone" | "tablet" {
    if (!this.isMobilePlatform()) return "desktop";
    const width = typeof window === "undefined" ? 1024 : window.innerWidth;
    if (width < 640) return "phone";
    if (width < 1024) return "tablet";
    return "desktop";
  }

  private applyLayoutPolicy(): void {
    if (typeof window === "undefined") return;
    const width = window.innerWidth;
    if (width <= 0) return;
    const mode = this.layoutMode();
    if (this.shell) {
      this.shell.dataset.layout = mode;
      this.shell.dataset.platform = mode === "desktop" ? "desktop" : "mobile";
    }
    const mobile = mode !== "desktop";
    this.layout.setAutoHidden(
      Part.AuxiliaryBar,
      mobile || width < 900,
      "responsive-policy",
    );
    this.layout.setAutoHidden(
      Part.Sidebar,
      mobile || width < 700,
      "responsive-policy",
    );
    this.layout.setAutoHidden(Part.Panel, mobile, "responsive-policy");
    this.syncPartVisibility();
  }
}
