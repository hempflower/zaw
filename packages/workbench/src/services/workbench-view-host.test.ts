// @vitest-environment happy-dom
import { Container, inject } from "inversify";
import { DisposableStore, Emitter } from "@zaw/ui";
import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../platform/actions/actions";
import { CommandRegistry } from "../platform/commands/command-service";
import { ContextKeyService } from "../platform/context-key/context-key-service";
import {
  ContextKeyExpr,
  IContextKeyService,
  RawContextKey,
} from "../platform/context-key/context-key";
import { WorkbenchViewHost } from "./workbench-view-host";
import {
  WorkbenchViewContainersRegistry,
  WorkbenchViewsRegistry,
  ViewRoot,
  ViewStaticArguments,
} from "./workbench-view-registry";

describe("WorkbenchViewHost", () => {
  it("keeps mounted views stable and disposes them when their descriptor is removed", () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry();
    const keys = new ContextKeyService();
    const container = new Container();
    container.bind(IContextKeyService).toConstantValue(keys);
    const host = new WorkbenchViewHost(containers, views, keys);
    host.setContainer(container);
    const root = document.createElement("div");
    host.mount("panel", root);
    const panel = containers.registerViewContainer({
      id: "panel",
      location: "panel",
      title: "Panel",
    });
    let disposed = 0;
    let staticArguments: readonly unknown[] = [];
    class TestView {
      readonly id = "test";
      constructor(@inject(ViewStaticArguments) args: readonly unknown[]) {
        staticArguments = args;
      }
      dispose() {
        disposed++;
      }
    }
    const registration = views.registerViews(
      [
        {
          id: "test",
          name: "Test",
          ctor: TestView,
          staticArguments: ["input"],
        },
      ],
      containers.get("panel")!,
    );
    const viewRoot = root.firstElementChild;
    expect(viewRoot?.getAttribute("data-workbench-view")).toBe("test");
    expect(staticArguments).toEqual(["input"]);
    keys.createKey("unused", false).set(true);
    expect(root.firstElementChild).toBe(viewRoot);
    expect(host.focus("test")).toBe(true);
    expect(host.activeViewID).toBe("test");
    registration.dispose();
    expect(disposed).toBe(1);
    expect(host.activeViewID).toBeUndefined();
    panel.dispose();
  });

  it("releases a contribution's view, command, menu and listeners", async () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry();
    const keys = new ContextKeyService();
    const container = new Container();
    container.bind(IContextKeyService).toConstantValue(keys);
    const host = new WorkbenchViewHost(containers, views, keys);
    host.setContainer(container);
    const root = document.createElement("div");
    host.mount("panel", root);
    const commands = new CommandRegistry();
    commands.setServicesAccessor({
      get: (id) => {
        if (id === IContextKeyService) return keys as never;
        throw new Error("unexpected service");
      },
    });
    const actions = new ActionRegistry(commands);
    const registrations = new DisposableStore();
    let executed = 0;
    let disposed = 0;
    class ExtensionView {
      readonly id = "example.view";
      dispose() {
        disposed++;
      }
    }
    const visible = keys.createKey("example.visible", false);
    registrations.add(
      containers.registerViewContainer({
        id: "example.container",
        location: "panel",
        title: "Example",
      }),
    );
    registrations.add(
      views.registerViews(
        [
          {
            id: "example.view",
            name: "Example",
            ctor: ExtensionView,
            when: ContextKeyExpr.has("example.visible"),
          },
        ],
        containers.get("example.container")!,
      ),
    );
    registrations.add(
      commands.registerCommand("example.run", () => {
        executed++;
      }),
    );
    registrations.add(
      actions.registerAction({
        id: "example.action",
        command: "example.run",
        menu: "view-title",
        title: "Run",
      }),
    );

    visible.set(true);
    expect(
      root.querySelector('[data-workbench-view="example.view"]'),
    ).not.toBeNull();
    await commands.executeCommand("example.run");
    expect(executed).toBe(1);
    expect(actions.actions("view-title").map((entry) => entry.id)).toContain(
      "example.action",
    );

    registrations.dispose();
    expect(disposed).toBe(1);
    expect(
      root.querySelector('[data-workbench-view="example.view"]'),
    ).toBeNull();
    expect(commands.hasCommand("example.run")).toBe(false);
    expect(actions.actions("view-title")).toEqual([]);
  });

  it("assigns each local update to its own view without remounting sibling feature views", () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry();
    const keys = new ContextKeyService();
    const container = new Container();
    const managementChanges = new Emitter<void>();
    const IManagementChanges = Symbol("IManagementChanges");
    container.bind(IContextKeyService).toConstantValue(keys);
    container
      .bind(IManagementChanges)
      .toConstantValue({ onDidChange: managementChanges.event });
    const host = new WorkbenchViewHost(containers, views, keys);
    host.setContainer(container);
    const root = document.createElement("div");
    host.mount("panel", root);
    const panel = containers.registerViewContainer({
      id: "panel",
      location: "panel",
      title: "Panel",
    });
    class SessionView {
      readonly id = "session";
      dispose() {}
    }
    class TerminalView {
      readonly id = "terminal";
      dispose() {}
    }
    class ManagementView {
      readonly id = "management";
      constructor(
        @inject(ViewRoot) root: HTMLElement,
        @inject(IManagementChanges)
        changes: { onDidChange: (listener: () => void) => { dispose(): void } },
      ) {
        root.replaceChildren(document.createTextNode("initial"));
        changes.onDidChange(() =>
          root.replaceChildren(document.createTextNode("changed")),
        );
      }
      dispose() {}
    }
    views.registerViews(
      [
        { id: "session", name: "Session", ctor: SessionView },
        { id: "terminal", name: "Terminal", ctor: TerminalView },
        { id: "management", name: "Management", ctor: ManagementView },
      ],
      containers.get("panel")!,
    );
    const session = root.querySelector('[data-workbench-view="session"]');
    const terminal = root.querySelector('[data-workbench-view="terminal"]');
    const management = root.querySelector('[data-workbench-view="management"]');
    managementChanges.fire();
    expect(root.querySelector('[data-workbench-view="session"]')).toBe(session);
    expect(root.querySelector('[data-workbench-view="terminal"]')).toBe(
      terminal,
    );
    expect(root.querySelector('[data-workbench-view="management"]')).toBe(
      management,
    );
    expect(management?.textContent).toBe("changed");
    panel.dispose();
  });

  it("retains stateful view DOM while its context visibility is false", () => {
    const containers = new WorkbenchViewContainersRegistry();
    const views = new WorkbenchViewsRegistry();
    const keys = new ContextKeyService();
    const container = new Container();
    container.bind(IContextKeyService).toConstantValue(keys);
    const host = new WorkbenchViewHost(containers, views, keys);
    host.setContainer(container);
    const root = document.createElement("div");
    host.mount("auxiliarybar", root);
    containers.registerViewContainer({
      id: "details",
      location: "auxiliarybar",
      title: "Details",
    });
    let disposed = 0;
    class StatefulView {
      readonly id = "stateful";
      dispose() {
        disposed++;
      }
    }
    const visible = keys.createKey("details.visible", true);
    views.registerViews(
      [
        {
          ctor: StatefulView,
          id: "stateful",
          name: "Stateful",
          retainWhenHidden: true,
          when: ContextKeyExpr.has("details.visible"),
        },
      ],
      containers.get("details")!,
    );
    const view = root.firstElementChild as HTMLElement;
    visible.set(false);
    expect(root.firstElementChild).toBe(view);
    expect(view.hidden).toBe(true);
    expect(view.inert).toBe(true);
    expect(disposed).toBe(0);
    visible.set(true);
    expect(root.firstElementChild).toBe(view);
    expect(view.hidden).toBe(false);
    expect(disposed).toBe(0);
  });
});
