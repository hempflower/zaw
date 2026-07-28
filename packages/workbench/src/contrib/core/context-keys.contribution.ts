import { Disposable } from "@zaw/ui";
import { inject, injectable } from "inversify";
import { IContextKeyService } from "../../platform/context-key/context-key";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";
import { PanelContext, ViewportContext } from "../../workbench/context-keys";

/** Owns framework (rather than feature) context keys for layout and viewport state. */
@injectable()
export class CoreContextKeysContribution
  extends Disposable
  implements IWorkbenchContribution
{
  private readonly listener: (() => void) | undefined;
  private readonly sidebar;
  private readonly auxiliary;
  private readonly panel;
  private readonly desktop;
  private readonly tablet;
  private readonly mobile;

  constructor(
    @inject(IContextKeyService) context: IContextKeyService,
    @inject(IWorkbenchLayoutService) layout: IWorkbenchLayoutService,
  ) {
    super();
    this.sidebar = PanelContext.leftSidebarVisible.bindTo(context);
    this.auxiliary = PanelContext.rightSidebarVisible.bindTo(context);
    this.panel = PanelContext.bottomPanelVisible.bindTo(context);
    this.desktop = ViewportContext.desktop.bindTo(context);
    this.tablet = ViewportContext.tablet.bindTo(context);
    this.mobile = ViewportContext.mobile.bindTo(context);
    const updateLayout = () => {
      this.sidebar.set(layout.isVisible(Part.Sidebar));
      this.auxiliary.set(layout.isVisible(Part.AuxiliaryBar));
      this.panel.set(layout.isVisible(Part.Panel));
    };
    const updateViewport = () => {
      const width = typeof window === "undefined" ? 1280 : window.innerWidth;
      const mobilePlatform =
        typeof navigator !== "undefined" &&
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      this.mobile.set(mobilePlatform && width < 640);
      this.tablet.set(mobilePlatform && width >= 640 && width < 1024);
      this.desktop.set(!mobilePlatform || width >= 1024);
    };
    updateLayout();
    updateViewport();
    this._register(layout.onDidTogglePart(updateLayout));
    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateViewport);
      this.listener = () =>
        window.removeEventListener("resize", updateViewport);
      this._register({ dispose: this.listener });
    }
  }
}
