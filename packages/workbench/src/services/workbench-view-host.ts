import { Disposable, createElement, type IDisposable } from "@zaw/ui";
import { inject, injectable } from "inversify";
import { Container } from "inversify";
import { IContextKeyService } from "../platform/context-key/context-key";
import {
  IWorkbenchViewContainersRegistry,
  IWorkbenchViewsRegistry,
  WorkbenchViewContainerLocation,
  ViewRoot,
  ViewStaticArguments,
} from "./workbench-view-registry";
import {
  IWorkbenchViewContainersRegistry as IWorkbenchViewContainersRegistryID,
  IWorkbenchViewsRegistry as IWorkbenchViewsRegistryID,
} from "./workbench-view-registry";

export const IWorkbenchViewHost = Symbol.for("IWorkbenchViewHost");
export interface IWorkbenchViewHost extends IDisposable {
  readonly activeViewID: string | undefined;
  focus(id: string): boolean;
  mount(location: WorkbenchViewContainerLocation, root: HTMLElement): void;
  setContainer(container: Container): void;
}

@injectable()
export class WorkbenchViewHost
  extends Disposable
  implements IWorkbenchViewHost
{
  private readonly mounted = new Map<string, MountedView>();
  private readonly locations = new Map<
    WorkbenchViewContainerLocation,
    HTMLElement
  >();
  private container: Container | null = null;
  private _activeViewID: string | undefined;

  get activeViewID(): string | undefined {
    return this._activeViewID;
  }

  constructor(
    @inject(IWorkbenchViewContainersRegistryID)
    private readonly containers: IWorkbenchViewContainersRegistry,
    @inject(IWorkbenchViewsRegistryID)
    private readonly views: IWorkbenchViewsRegistry,
    @inject(IContextKeyService)
    private readonly contextKeys: IContextKeyService,
  ) {
    super();
    this._register({ dispose: () => this.disposeMounted() });
    this._register(this.containers.onDidRegister(() => this.sync()));
    this._register(this.containers.onDidDeregister(() => this.sync()));
    this._register(this.views.onViewsRegistered(() => this.sync()));
    this._register(this.views.onViewsDeregistered(() => this.sync()));
    this._register(this.contextKeys.onDidChangeContext(() => this.sync()));
  }

  /**
   * Set the Inversify container for DI-based View instantiation.
   * Must be called after the container is assembled.
   */
  setContainer(container: Container): void {
    this.container = container;
  }

  mount(location: WorkbenchViewContainerLocation, root: HTMLElement): void {
    this.locations.set(location, root);
    this.sync();
  }

  focus(id: string): boolean {
    const mounted = this.mounted.get(id);
    if (!mounted || mounted.root.hidden) return false;
    mounted.root.focus();
    this._activeViewID = id;
    return true;
  }

  private sync(): void {
    if (!this.container) return;
    const wanted = new Set<string>();
    for (const viewContainer of this.containers.all) {
      const location = this.locations.get(viewContainer.location);
      if (!location) continue;
      for (const descriptor of this.views.getViews(viewContainer)) {
        const visible =
          !descriptor.when || this.contextKeys.evaluate(descriptor.when);
        const mounted = this.mounted.get(descriptor.id);
        if (!visible) {
          if (descriptor.retainWhenHidden && mounted) {
            wanted.add(descriptor.id);
            this.setViewVisible(mounted.root, false);
          }
          continue;
        }
        wanted.add(descriptor.id);
        if (mounted) {
          this.setViewVisible(mounted.root, true);
          continue;
        }
        const root = createElement("div");
        root.dataset.workbenchView = descriptor.id;
        root.tabIndex = -1;
        root.addEventListener("focusin", () => {
          this._activeViewID = descriptor.id;
        });
        const child = new Container({ parent: this.container });
        child.bind<HTMLElement>(ViewRoot).toConstantValue(root);
        child
          .bind<readonly unknown[]>(ViewStaticArguments)
          .toConstantValue(descriptor.staticArguments ?? []);
        child.bind(descriptor.ctor).toSelf();
        try {
          const instance = child.get<IDisposable>(descriptor.ctor);
          location.append(root);
          this.mounted.set(descriptor.id, { child, instance, root });
        } catch (error) {
          child.unbindAll();
          root.remove();
          console.error(`Failed to create view "${descriptor.id}":`, error);
        }
      }
    }
    for (const [id, mounted] of this.mounted) {
      if (wanted.has(id)) continue;
      mounted.instance.dispose();
      mounted.child.unbindAll();
      mounted.root.remove();
      this.mounted.delete(id);
      if (this._activeViewID === id) this._activeViewID = undefined;
    }
  }

  private setViewVisible(root: HTMLElement, visible: boolean): void {
    root.hidden = !visible;
    root.inert = !visible;
    root.setAttribute("aria-hidden", String(!visible));
  }

  private disposeMounted(): void {
    for (const mounted of this.mounted.values()) {
      mounted.instance.dispose();
      mounted.child.unbindAll();
      mounted.root.remove();
    }
    this.mounted.clear();
    this._activeViewID = undefined;
  }
}

type MountedView = {
  child: Container;
  instance: IDisposable;
  root: HTMLElement;
};
