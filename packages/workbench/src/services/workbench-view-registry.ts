import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import type { ContextKeyExpression } from "../platform/context-key/context-key";

export const IWorkbenchViewContainersRegistry = Symbol.for(
  "IWorkbenchViewContainersRegistry",
);
export const IWorkbenchViewsRegistry = Symbol.for("IWorkbenchViewsRegistry");

export type WorkbenchViewContainerLocation =
  | "auxiliarybar"
  | "overlay"
  | "panel"
  | "primary"
  | "sidebar"
  | "titlebar";

export type WorkbenchViewContainer = {
  id: string;
  location: WorkbenchViewContainerLocation;
  order?: number;
  title: string;
};

/**
 * Interface that DI-created Views must implement.
 * Views receive their dependencies via @inject() and own their DOM.
 */
export interface IWorkbenchView extends IDisposable {
  /** Unique view identifier matching the descriptor. */
  readonly id: string;
}

export const ViewRoot = Symbol.for("WorkbenchViewRoot");
/** Descriptor-provided immutable data for a single DI-created View instance. */
export const ViewStaticArguments = Symbol.for("WorkbenchViewStaticArguments");

export type WorkbenchViewDescriptor = {
  /** A view is always created by a scoped DI container. */
  ctor: new (...args: never[]) => IWorkbenchView;
  id: string;
  name: string;
  order?: number;
  /** Keep the DI instance and DOM identity while its `when` clause is false. */
  retainWhenHidden?: boolean;
  staticArguments?: readonly unknown[];
  /** Shared visibility expression for the view, commands and actions. */
  when?: ContextKeyExpression;
};

export interface IWorkbenchViewContainersRegistry {
  readonly all: WorkbenchViewContainer[];
  readonly onDidDeregister: Event<WorkbenchViewContainer>;
  readonly onDidRegister: Event<WorkbenchViewContainer>;
  get(id: string): WorkbenchViewContainer | undefined;
  getViewContainers(
    location: WorkbenchViewContainerLocation,
  ): WorkbenchViewContainer[];
  registerViewContainer(container: WorkbenchViewContainer): IDisposable;
}

@injectable()
export class WorkbenchViewContainersRegistry
  extends Disposable
  implements IWorkbenchViewContainersRegistry
{
  private readonly containers = new Map<string, WorkbenchViewContainer>();
  private readonly _onDidDeregister = this._register(
    new Emitter<WorkbenchViewContainer>(),
  );
  private readonly _onDidRegister = this._register(
    new Emitter<WorkbenchViewContainer>(),
  );
  readonly onDidDeregister = this._onDidDeregister.event;
  readonly onDidRegister = this._onDidRegister.event;

  get all() {
    return [...this.containers.values()].sort(compareOrder);
  }

  get(id: string) {
    return this.containers.get(id);
  }

  getViewContainers(location: WorkbenchViewContainerLocation) {
    return this.all.filter((container) => container.location === location);
  }

  registerViewContainer(container: WorkbenchViewContainer): IDisposable {
    if (this.containers.has(container.id)) {
      throw new Error(`View container ${container.id} is already registered`);
    }
    this.containers.set(container.id, container);
    this._onDidRegister.fire(container);
    return {
      dispose: () => {
        if (this.containers.get(container.id) !== container) return;
        this.containers.delete(container.id);
        this._onDidDeregister.fire(container);
      },
    };
  }
}

export type WorkbenchViewsChange = {
  container: WorkbenchViewContainer;
  views: WorkbenchViewDescriptor[];
};

export interface IWorkbenchViewsRegistry {
  readonly onViewsDeregistered: Event<WorkbenchViewsChange>;
  readonly onViewsRegistered: Event<WorkbenchViewsChange>;
  getView(id: string): WorkbenchViewDescriptor | undefined;
  getViewContainer(viewID: string): WorkbenchViewContainer | undefined;
  getViews(container: WorkbenchViewContainer): WorkbenchViewDescriptor[];
  registerViews(
    views: WorkbenchViewDescriptor[],
    container: WorkbenchViewContainer,
  ): IDisposable;
}

@injectable()
export class WorkbenchViewsRegistry
  extends Disposable
  implements IWorkbenchViewsRegistry
{
  private readonly containerByViewID = new Map<
    string,
    WorkbenchViewContainer
  >();
  private readonly views = new Map<string, WorkbenchViewDescriptor[]>();
  private readonly _onViewsDeregistered = this._register(
    new Emitter<WorkbenchViewsChange>(),
  );
  private readonly _onViewsRegistered = this._register(
    new Emitter<WorkbenchViewsChange>(),
  );
  readonly onViewsDeregistered = this._onViewsDeregistered.event;
  readonly onViewsRegistered = this._onViewsRegistered.event;

  getView(id: string) {
    const container = this.containerByViewID.get(id);
    return container
      ? this.views.get(container.id)?.find((view) => view.id === id)
      : undefined;
  }

  getViewContainer(viewID: string) {
    return this.containerByViewID.get(viewID);
  }

  getViews(container: WorkbenchViewContainer) {
    return [...(this.views.get(container.id) ?? [])].sort(compareOrder);
  }

  registerViews(
    views: WorkbenchViewDescriptor[],
    container: WorkbenchViewContainer,
  ): IDisposable {
    const duplicate = views.find((view) => this.containerByViewID.has(view.id));
    if (duplicate) {
      throw new Error(`View ${duplicate.id} is already registered`);
    }
    const duplicateInBatch = views.find(
      (view, index) =>
        views.findIndex((candidate) => candidate.id === view.id) !== index,
    );
    if (duplicateInBatch) {
      throw new Error(`View ${duplicateInBatch.id} is already registered`);
    }
    const registered = [...views];
    this.views.set(container.id, [
      ...(this.views.get(container.id) ?? []),
      ...registered,
    ]);
    for (const view of registered) {
      this.containerByViewID.set(view.id, container);
    }
    this._onViewsRegistered.fire({ container, views: registered });
    return {
      dispose: () => {
        const current = this.views.get(container.id) ?? [];
        const removed = registered.filter(
          (view) => this.containerByViewID.get(view.id) === container,
        );
        if (!removed.length) return;
        const removedIDs = new Set(removed.map((view) => view.id));
        const remaining = current.filter((view) => !removedIDs.has(view.id));
        if (remaining.length) this.views.set(container.id, remaining);
        else this.views.delete(container.id);
        for (const view of removed) this.containerByViewID.delete(view.id);
        this._onViewsDeregistered.fire({ container, views: removed });
      },
    };
  }
}

function compareOrder(
  left: { id: string; order?: number },
  right: { id: string; order?: number },
) {
  return (
    (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
  );
}
