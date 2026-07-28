import { DisposableStore } from "@zaw/ui";
import { inject, injectable } from "inversify";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  type IWorkbenchViewsRegistry as ViewsRegistry,
  type IWorkbenchViewContainersRegistry as ContainersRegistry,
} from "../../services/workbench-view-registry";
import { TitlebarView } from "../../views/workbench/titlebar-view";
import { IContextKeyService } from "../../platform/context-key/context-key";
import { IWorkbenchLayoutService, Part } from "../../workbench/layout/layout";

@injectable()
export class CoreViewsContribution implements IWorkbenchContribution {
  private readonly registrations = new DisposableStore();

  constructor(
    @inject(IWorkbenchViewContainersRegistry)
    containers: ContainersRegistry,
    @inject(IWorkbenchViewsRegistry) views: ViewsRegistry,
    @inject(IContextKeyService) context: IContextKeyService,
    @inject(IWorkbenchLayoutService) layout: IWorkbenchLayoutService,
  ) {
    const locations = [
      ["core.titlebar", "titlebar", "Title bar"],
      ["core.sidebar", "sidebar", "Sidebar"],
      ["core.primary", "primary", "Primary"],
      ["core.auxiliary", "auxiliarybar", "Auxiliary"],
      ["core.panel", "panel", "Panel"],
      ["core.overlay", "overlay", "Overlay"],
    ] as const;
    for (const [id, location, title] of locations) {
      const registration = containers.registerViewContainer({
        id,
        location,
        title,
      });
      this.registrations.add(registration);
    }
    const titlebar = containers.get("core.titlebar");
    if (titlebar) {
      this.registrations.add(
        views.registerViews(
          [
            {
              id: "zaw.workbench.titlebar",
              name: "Title bar",
              ctor: TitlebarView,
            },
          ],
          titlebar,
        ),
      );
    }

    const syncAuxiliaryVisibility = () => {
      const auxiliary = containers.get("core.auxiliary");
      const hasActiveView =
        auxiliary !== undefined &&
        views
          .getViews(auxiliary)
          .some((view) => !view.when || context.evaluate(view.when));
      layout.setAutoHidden(
        Part.AuxiliaryBar,
        !hasActiveView,
        "active-view-container",
      );
    };
    syncAuxiliaryVisibility();
    this.registrations.add(views.onViewsRegistered(syncAuxiliaryVisibility));
    this.registrations.add(views.onViewsDeregistered(syncAuxiliaryVisibility));
    this.registrations.add(context.onDidChangeContext(syncAuxiliaryVisibility));
  }

  dispose(): void {
    this.registrations.dispose();
  }
}
