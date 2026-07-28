import { Disposable, Emitter, createElement, type IDisposable } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import { IWorkbenchStorage } from "../../services/workspace-ui-state";
import { IWorkbenchLayoutService, Part } from "./layout";

@injectable()
export class WorkbenchLayoutService
  extends Disposable
  implements IWorkbenchLayoutService
{
  private readonly partRoots = new Map<Part, HTMLElement>();
  private readonly visibility = new Map<Part, boolean>([
    [Part.Titlebar, true],
    [Part.Sidebar, true],
    [Part.Primary, true],
    [Part.AuxiliaryBar, true],
    [Part.Panel, false],
    [Part.Overlay, true],
  ]);
  private readonly autoHidden = new Map<Part, Set<string>>();
  private readonly toggleEmitter = this._register(
    new Emitter<{ part: Part; visible: boolean }>(),
  );
  readonly onDidTogglePart = this.toggleEmitter.event;
  private readonly sizeEmitter = this._register(new Emitter<Part>());
  readonly onDidChangeSize = this.sizeEmitter.event;
  private readonly editorVisibilityEmitter = this._register(
    new Emitter<boolean>(),
  );
  readonly onDidChangeEditorVisibility = this.editorVisibilityEmitter.event;

  private _sidebarWidth = 300;
  private _auxiliaryBarWidth = 340;
  private _panelHeight = 300;
  private _editorVisible = false;

  constructor(
    @optional() @inject(IWorkbenchStorage) private readonly storage?: Storage,
  ) {
    super();
    this.restore();
    // Register disposal of all part roots
    this._register({
      dispose: () => {
        for (const root of this.partRoots.values()) {
          root.remove();
        }
        this.partRoots.clear();
      },
    });
  }

  get sidebarWidth(): number {
    return this._sidebarWidth;
  }

  setSidebarWidth(width: number): void {
    const next = Math.max(270, width);
    if (next === this._sidebarWidth) return;
    this._sidebarWidth = next;
    this.persist();
    this.sizeEmitter.fire(Part.Sidebar);
  }

  get auxiliaryBarWidth(): number {
    return this._auxiliaryBarWidth;
  }

  setAuxiliaryBarWidth(width: number): void {
    const next = Math.max(270, width);
    if (next === this._auxiliaryBarWidth) return;
    this._auxiliaryBarWidth = next;
    this.persist();
    this.sizeEmitter.fire(Part.AuxiliaryBar);
  }

  get panelHeight(): number {
    return this._panelHeight;
  }

  get editorVisible(): boolean {
    return this._editorVisible;
  }

  setEditorVisible(visible: boolean): void {
    if (visible === this._editorVisible) return;
    this._editorVisible = visible;
    this.editorVisibilityEmitter.fire(visible);
  }

  setPanelHeight(height: number): void {
    const next = Math.max(77, height);
    if (next === this._panelHeight) return;
    this._panelHeight = next;
    this.persist();
    this.sizeEmitter.fire(Part.Panel);
  }

  getPartRoot(part: Part): HTMLElement {
    let root = this.partRoots.get(part);
    if (!root) {
      root = createElement("div");
      root.dataset.workbenchPart = part;
      root.style.display = this.isVisible(part) ? "" : "none";
      this.partRoots.set(part, root);
    }
    return root;
  }

  isVisible(part: Part): boolean {
    return (
      (this.visibility.get(part) ?? false) &&
      (this.autoHidden.get(part)?.size ?? 0) === 0
    );
  }

  setVisible(part: Part, visible: boolean): void {
    const previous = this.isVisible(part);
    const manual = this.visibility.get(part);
    this.visibility.set(part, visible);
    this.autoHidden.delete(part);
    const current = this.isVisible(part);
    if (manual === visible && previous === current) return;

    this.updatePartVisibility(part, current);
    this.persist();
  }

  setAutoHidden(part: Part, hidden: boolean, source = "default"): void {
    const previous = this.isVisible(part);
    const sources = this.autoHidden.get(part) ?? new Set<string>();
    if (hidden) {
      sources.add(source);
      this.autoHidden.set(part, sources);
    } else {
      sources.delete(source);
      if (sources.size === 0) this.autoHidden.delete(part);
    }
    const current = this.isVisible(part);
    if (previous === current) return;
    this.updatePartVisibility(part, current);
  }

  private updatePartVisibility(part: Part, visible: boolean): void {
    const root = this.partRoots.get(part);
    if (root) {
      root.style.display = visible ? "" : "none";
    }
    this.toggleEmitter.fire({ part, visible });
  }

  private restore(): void {
    try {
      const saved = this.storage?.getItem("zaw.workbench.layout");
      if (!saved) return;
      const value = JSON.parse(saved) as Partial<{
        visibility: Record<Part, boolean>;
        sidebarWidth: number;
        auxiliaryBarWidth: number;
        panelHeight: number;
      }>;
      if (Number.isFinite(value.sidebarWidth))
        this._sidebarWidth = Math.max(270, value.sidebarWidth!);
      if (Number.isFinite(value.auxiliaryBarWidth))
        this._auxiliaryBarWidth = Math.max(270, value.auxiliaryBarWidth!);
      if (Number.isFinite(value.panelHeight))
        this._panelHeight = Math.max(77, value.panelHeight!);
      for (const part of Object.values(Part)) {
        const visible = value.visibility?.[part];
        if (typeof visible === "boolean") this.visibility.set(part, visible);
      }
    } catch {
      /* Invalid browser storage must not block startup. */
    }
  }

  private persist(): void {
    this.storage?.setItem(
      "zaw.workbench.layout",
      JSON.stringify({
        visibility: Object.fromEntries(this.visibility),
        sidebarWidth: this._sidebarWidth,
        auxiliaryBarWidth: this._auxiliaryBarWidth,
        panelHeight: this._panelHeight,
      }),
    );
  }
}
