import {
  ButtonWidget,
  Widget,
  append,
  createElement,
  type IDisposable,
} from "@zaw/ui";
import type {
  DetailTabViewModel,
  FileViewModel,
  WorkspaceChangeViewModel,
} from "../models";
import type {
  DetailTabRendererContext,
  IDetailTabRendererRegistry,
} from "./detail-tab-renderer-registry";

class ChangesDetailRenderer extends Widget {
  constructor(root: HTMLElement, context: DetailTabRendererContext) {
    super(root);
    const list = createElement("ul", { className: "change-list" });
    context.changes.forEach((change) =>
      list.append(this.renderChange(change, context)),
    );
    this.root.replaceChildren(list);
  }

  private renderChange(
    change: WorkspaceChangeViewModel,
    context: DetailTabRendererContext,
  ) {
    const row = createElement("li", { className: "change-row" });
    const open = this.button(
      change.path,
      undefined,
      () => context.emitAction({ kind: "openChange", path: change.path }),
      undefined,
      "change-path",
    );
    const review = this.button(
      `${change.reviewed ? "Mark unreviewed" : "Mark reviewed"} ${change.path}`,
      "eye",
      () => context.emitAction({ kind: "reviewChange", path: change.path }),
      change.reviewed ? "reviewed" : undefined,
    );
    const stage = this.button(`Accept ${change.path}`, "check", () =>
      context.emitAction({ kind: "stageChange", path: change.path }),
    );
    const revert = this.button(`Restore ${change.path}`, "discard", () =>
      context.emitAction({ kind: "requestRevertChange", path: change.path }),
    );
    const actions = createElement("span", { className: "change-actions" });
    append(actions, review, stage, revert);
    append(
      row,
      createElement("span", {
        className: "file-status",
        textContent: change.status,
      }),
      open,
      actions,
    );
    return row;
  }

  private button(
    label: string,
    icon?: string,
    onDidClick?: () => void,
    className?: string,
    text?: string,
  ) {
    const root = createElement("span");
    const widget = new ButtonWidget(root, {
      className,
      icon,
      label,
      text: text ?? (icon ? undefined : label),
    });
    if (onDidClick) widget.onDidClick(onDidClick, undefined, this.disposables);
    return root.firstElementChild ?? root;
  }
}

class FilesDetailRenderer extends Widget {
  constructor(root: HTMLElement, context: DetailTabRendererContext) {
    super(root);
    const list = createElement("ul", { className: "file-list" });
    context.files.forEach((file) =>
      list.append(this.renderFile(file, context)),
    );
    this.root.replaceChildren(list);
  }

  private renderFile(file: FileViewModel, context: DetailTabRendererContext) {
    const fileButton = this.button(
      file.name,
      file.type === "directory" ? "chevron-right" : "file",
      () =>
        context.emitAction(
          file.type === "directory"
            ? { kind: "openDirectory", uri: file.uri }
            : { kind: "openFile", uri: file.uri },
        ),
      undefined,
      file.name,
    );
    const item = createElement("li");
    item.append(fileButton);
    return item;
  }

  private button(
    label: string,
    icon?: string,
    onDidClick?: () => void,
    className?: string,
    text?: string,
  ) {
    const root = createElement("span");
    const widget = new ButtonWidget(root, {
      className,
      icon,
      label,
      text: text ?? (icon ? undefined : label),
    });
    if (onDidClick) widget.onDidClick(onDidClick, undefined, this.disposables);
    return root.firstElementChild ?? root;
  }
}

class PreviewDetailRenderer extends Widget {
  constructor(root: HTMLElement, activeTab: DetailTabViewModel) {
    super(root);
    this.root.replaceChildren(
      createElement("pre", {
        className: "file-preview",
        textContent: activeTab.content ?? "",
      }),
    );
  }
}

export function registerBuiltinDetailTabRenderers(
  registry: IDetailTabRendererRegistry,
): IDisposable[] {
  return [
    registry.register({
      factory: (root, _activeTab, context) =>
        new ChangesDetailRenderer(root, context),
      icon: "source-control",
      id: "detail-tab.changes",
      kind: "changes",
      order: 10,
      showWorkspaceScope: true,
      renderHeader: (root, _activeTab, context) => {
        const summary = createElement("p", { className: "changes-summary" });
        append(
          summary,
          document.createTextNode(`${context.changes.length} files · `),
          createElement("span", { textContent: `+${context.changes.length}` }),
          document.createTextNode(" · "),
          createElement("i", { textContent: "0" }),
        );
        root.append(summary);
      },
    }),
    registry.register({
      factory: (root, _activeTab, context) =>
        new FilesDetailRenderer(root, context),
      icon: "files",
      id: "detail-tab.files",
      kind: "files",
      order: 20,
      showWorkspaceScope: true,
    }),
    registry.register({
      factory: (root, activeTab) => new PreviewDetailRenderer(root, activeTab),
      icon: "file-code",
      id: "detail-tab.preview",
      kind: "preview",
      order: 30,
    }),
  ];
}
