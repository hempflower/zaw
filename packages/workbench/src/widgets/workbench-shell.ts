import { Widget, append, createElement } from "@zaw/ui";
import type { WorkbenchViewContainerLocation } from "../services/workbench-view-registry";

export type WorkbenchShellOptions = {
  leftPanelVisible: boolean;
  leftPanelWidth: number;
  locations: ReadonlyMap<WorkbenchViewContainerLocation, readonly Node[]>;
  rightPanelVisible: boolean;
  rightPanelWidth: number;
};

export class WorkbenchShell extends Widget {
  constructor(
    root: HTMLElement,
    private readonly options: WorkbenchShellOptions,
  ) {
    super(root);
    const shellOptions = this.options;
    const visibility = [
      shellOptions.leftPanelVisible ? "" : "left-panel-hidden",
      shellOptions.rightPanelVisible ? "" : "right-panel-hidden",
    ]
      .filter(Boolean)
      .join(" ");
    const main = createElement("main", {
      className: `zaw-workbench ${visibility}`,
    });
    main.style.setProperty(
      "--zaw-left-panel-width",
      `${shellOptions.leftPanelWidth}px`,
    );
    main.style.setProperty(
      "--zaw-right-panel-width",
      `${shellOptions.rightPanelWidth}px`,
    );
    const leftResize = createElement("div", {
      className: "panel-resize-handle left",
    });
    leftResize.dataset.resizePanel = "left";
    const rightResize = createElement("div", {
      className: "panel-resize-handle right",
    });
    rightResize.dataset.resizePanel = "right";
    const primary = createElement("div", {
      className: "workbench-primary-location",
    });
    append(primary, ...this.location("primary"), ...this.location("panel"));
    append(
      main,
      ...this.location("titlebar"),
      ...this.location("sidebar"),
      leftResize,
      primary,
      rightResize,
      ...this.location("auxiliarybar"),
      ...this.location("overlay"),
    );
    this.root.replaceChildren(main);
  }

  private location(location: WorkbenchViewContainerLocation) {
    return this.options.locations.get(location) ?? [];
  }
}
