import { Disposable } from "@zaw/ui";
import { inject, injectable, optional } from "inversify";
import {
  IActiveSessionService,
  type IActiveSessionService as ActiveSessionService,
} from "../../services/active-session";
import { IWorkbenchStorage } from "../../services/workspace-ui-state";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";

export const RESPONSIVE_SIDEBAR_SETTING =
  "sessions.layout.autoCollapseSessionsSidebar";
const RESPONSIVE_SOURCE = "responsive-sessions-sidebar";
const SMALL_WINDOW_MAX_WIDTH = 1800;

/** Source-aligned implementation of Sessions layout rule D7. */
@injectable()
export class ResponsiveSidebarContribution
  extends Disposable
  implements IWorkbenchContribution
{
  private previousConstrained: boolean;
  private sidebarAutoHidden = false;
  private applyingAutoSidebar = false;
  private readonly resizeListener: (() => void) | undefined;
  private readonly storageListener: ((event: StorageEvent) => void) | undefined;

  constructor(
    @inject(IWorkbenchLayoutService)
    private readonly layout: IWorkbenchLayoutService,
    @optional() @inject(IWorkbenchStorage) private readonly storage?: Storage,
    @optional()
    @inject(IActiveSessionService)
    activeSession?: ActiveSessionService,
  ) {
    super();
    this.previousConstrained = this.isConstrained();
    this._register(
      layout.onDidChangeEditorVisibility(() => this.updateResponsiveState()),
    );
    this._register(
      layout.onDidTogglePart(({ part }) => {
        if (part === Part.Sidebar && !this.applyingAutoSidebar)
          this.sidebarAutoHidden = false;
        this.updateResponsiveState();
      }),
    );
    if (activeSession)
      this._register(
        activeSession.onDidChange(() => {
          // Session restores establish a new baseline; navigation itself never
          // creates a D7 auto-hide transition.
          this.previousConstrained = this.isConstrained();
        }),
      );
    if (typeof window !== "undefined") {
      this.resizeListener = () => this.updateResponsiveState();
      this.storageListener = (event) => {
        if (event.key === RESPONSIVE_SIDEBAR_SETTING)
          this.updateResponsiveState();
      };
      window.addEventListener("resize", this.resizeListener);
      window.addEventListener("storage", this.storageListener);
      this._register({
        dispose: () => {
          window.removeEventListener("resize", this.resizeListener!);
          window.removeEventListener("storage", this.storageListener!);
        },
      });
    }
  }

  private updateResponsiveState(): void {
    const constrained = this.isConstrained();
    if (constrained === this.previousConstrained) return;
    this.previousConstrained = constrained;
    if (constrained) {
      if (this.setSidebarAutoHidden(true)) this.sidebarAutoHidden = true;
    } else if (this.sidebarAutoHidden) {
      this.setSidebarAutoHidden(false);
      this.sidebarAutoHidden = false;
    }
  }

  private isConstrained(): boolean {
    return (
      this.enabled() &&
      this.viewportWidth() <= SMALL_WINDOW_MAX_WIDTH &&
      this.layout.editorVisible &&
      this.layout.isVisible(Part.AuxiliaryBar)
    );
  }

  private enabled(): boolean {
    try {
      return this.storage?.getItem(RESPONSIVE_SIDEBAR_SETTING) === "true";
    } catch {
      return false;
    }
  }

  private viewportWidth(): number {
    return typeof window === "undefined"
      ? Number.POSITIVE_INFINITY
      : window.innerWidth;
  }

  private setSidebarAutoHidden(hidden: boolean): boolean {
    if (this.layout.isVisible(Part.Sidebar) === !hidden) return false;
    this.applyingAutoSidebar = true;
    try {
      this.layout.setAutoHidden(Part.Sidebar, hidden, RESPONSIVE_SOURCE);
    } finally {
      this.applyingAutoSidebar = false;
    }
    return true;
  }
}
