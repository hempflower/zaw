import { Disposable, createElement, type IDisposable } from "@zaw/ui";
import { inject, injectable } from "inversify";
import type {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  WorkbenchViewContainerLocation,
} from "./workbench-view-registry";
import {
  IWorkbenchViewContainersRegistry as IWorkbenchViewContainersRegistryID,
  IWorkbenchViewsRegistry as IWorkbenchViewsRegistryID,
} from "./workbench-view-registry";

export const IWorkbenchViewHost = Symbol.for("IWorkbenchViewHost");

export type WorkbenchViewHostResult = Readonly<{
  byLocation: ReadonlyMap<WorkbenchViewContainerLocation, readonly Node[]>;
  getContainerNode(id: string): HTMLElement | undefined;
  getLocationNodes(location: WorkbenchViewContainerLocation): readonly Node[];
}>;

@injectable()
export class WorkbenchViewHost<TContext> extends Disposable {
  private renderDisposables: IDisposable[] = [];

  constructor(
    @inject(IWorkbenchViewContainersRegistryID)
    private readonly containers: IWorkbenchViewContainersRegistry,
    @inject(IWorkbenchViewsRegistryID)
    private readonly views: IWorkbenchViewsRegistry<TContext>,
  ) {
    super();
    this._register({ dispose: () => this.disposeRender() });
  }

  render(context: TContext): WorkbenchViewHostResult {
    this.disposeRender();
    const byLocation = new Map<WorkbenchViewContainerLocation, Node[]>();
    const byContainer = new Map<string, HTMLElement>();
    for (const container of this.containers.all) {
      const containerRoot = createElement("div");
      containerRoot.dataset.workbenchViewContainer = container.id;
      containerRoot.style.display = "contents";
      for (const descriptor of this.views.getViews(container)) {
        if (descriptor.when && !descriptor.when(context)) continue;
        const viewRoot = createElement("div");
        viewRoot.dataset.workbenchView = descriptor.id;
        viewRoot.style.display = "contents";
        containerRoot.append(viewRoot);
        const disposable = descriptor.factory(viewRoot, context, descriptor);
        if (disposable) this.renderDisposables.push(disposable);
      }
      byContainer.set(container.id, containerRoot);
      const nodes = byLocation.get(container.location) ?? [];
      nodes.push(containerRoot);
      byLocation.set(container.location, nodes);
    }
    return {
      byLocation,
      getContainerNode: (id) => byContainer.get(id),
      getLocationNodes: (location) => byLocation.get(location) ?? [],
    };
  }

  private disposeRender() {
    for (const disposable of this.renderDisposables.splice(0)) {
      disposable.dispose();
    }
  }
}
