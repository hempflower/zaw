import { inject, injectable } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import { IContextKeyService } from "../../platform/context-key/context-key";
import { IKeybindingRegistry } from "../../platform/keybinding/keybindings";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";

/** Bridges declarative keybindings to commands without leaking listeners into Workbench. */
@injectable()
export class KeybindingsContribution implements IWorkbenchContribution {
  private readonly listener: ((event: KeyboardEvent) => void) | undefined;

  constructor(
    @inject(IKeybindingRegistry) keybindings: IKeybindingRegistry,
    @inject(IContextKeyService) contextKeys: IContextKeyService,
    @inject(ICommandService) commands: ICommandService,
  ) {
    if (typeof window === "undefined") return;
    this.listener = (event) => {
      const key = keyFor(event);
      const binding = keybindings
        .all()
        .find(
          (entry) =>
            entry.key === key &&
            (!entry.precondition || contextKeys.evaluate(entry.precondition)),
        );
      if (!binding) return;
      event.preventDefault();
      void commands.executeCommand(binding.command);
    };
    window.addEventListener("keydown", this.listener);
  }

  dispose(): void {
    if (this.listener) window.removeEventListener("keydown", this.listener);
  }
}

function keyFor(event: KeyboardEvent): string {
  return [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.key.length === 1 ? event.key.toUpperCase() : event.key,
  ]
    .filter(Boolean)
    .join("+");
}
