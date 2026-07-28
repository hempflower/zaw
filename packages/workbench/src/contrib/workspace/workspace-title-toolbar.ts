import { Disposable, Toolbar, createElement } from "@zaw/ui";
import type {
  IActionRegistry,
  ActionDescriptor,
} from "../../platform/actions/actions";
import type { ICommandService } from "../../platform/commands/commands";
import type { IContextKeyService } from "../../platform/context-key/context-key";

/** Renders workspace view-title menu contributions into a compact toolbar. */
export class WorkspaceTitleToolbar extends Disposable {
  readonly element = createElement("div", {
    className: "agent-auxiliary-header-actions",
  });
  private toolbar: Toolbar | undefined;

  constructor(
    private readonly currentCommand: string | undefined,
    private readonly actions: IActionRegistry,
    private readonly commands: ICommandService,
    private readonly context: IContextKeyService,
    private readonly kind: "actions" | "close" = "actions",
  ) {
    super();
    this._register(this.actions.onDidChange(() => this.render()));
    this._register(
      this.context.onDidChangeContext(() => this.syncActionState()),
    );
    this.render();
  }

  override dispose(): void {
    this.toolbar?.dispose();
    super.dispose();
  }

  private descriptors(): readonly ActionDescriptor[] {
    return this.actions
      .actions("view-title")
      .filter(
        (action) =>
          action.command.startsWith("zaw.workspace.") &&
          action.command !== this.currentCommand &&
          (this.kind === "close"
            ? action.command === "zaw.workspace.closeActiveView"
            : action.command !== "zaw.workspace.closeActiveView"),
      );
  }

  private render(): void {
    this.toolbar?.dispose();
    const descriptors = this.descriptors();
    this.toolbar = new Toolbar(this.element, {
      actions: descriptors.map((action) => ({
        ariaLabel: action.title,
        checked: action.checkedWhen
          ? this.context.evaluate(action.checkedWhen)
          : false,
        disabled: action.precondition
          ? !this.context.evaluate(action.precondition)
          : false,
        icon: action.icon,
        id: action.id,
        kind: "icon",
        title: action.title,
      })),
      ariaLabel: "Workspace view actions",
    });
    this.toolbar.onDidRun(({ id }) => {
      const action = descriptors.find((candidate) => candidate.id === id);
      if (action) void this.commands.executeCommand(action.command);
    });
  }

  private syncActionState(): void {
    if (!this.toolbar) return;
    for (const descriptor of this.descriptors()) {
      const action = this.toolbar.action(descriptor.id);
      action?.setChecked(
        descriptor.checkedWhen
          ? this.context.evaluate(descriptor.checkedWhen)
          : false,
      );
      action?.setDisabled(
        descriptor.precondition
          ? !this.context.evaluate(descriptor.precondition)
          : false,
      );
    }
  }
}
