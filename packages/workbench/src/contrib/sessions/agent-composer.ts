import {
  Disposable,
  DisposableStore,
  IconActionButton,
  PickerAction,
  createElement,
} from "@zaw/ui";
import type { ChatComposition } from "../../services/chat-session";
import type {
  IActionRegistry,
  ActionDescriptor,
} from "../../platform/actions/actions";
import type { ICommandService } from "../../platform/commands/commands";

export type ComposerModel = {
  id: string;
  name: string;
  vendor?: string;
  upstreamModel?: string;
  isDefault?: boolean;
  capabilities?: {
    reasoning?: boolean;
    reasoningEfforts?: string[];
  };
};

export type ComposerAgent = {
  id: string;
  name: string;
};

export type AgentComposerOptions = {
  actions?: IActionRegistry;
  ariaLabel: string;
  composition: () => ChatComposition;
  commands?: ICommandService;
  disabled?: () => boolean;
  models: () => readonly ComposerModel[];
  modelsState?: () => "error" | "idle" | "loading" | "ready";
  onChange: (changes: Partial<ChatComposition>) => void;
  onSubmit: () => void;
  placeholder: () => string;
  notification?: () => { kind: "error" | "info"; message: string } | undefined;
  working?: () => boolean;
  workingAction?: "cancel" | "progress";
};

export type ComposerActionContext = {
  attach: () => void;
  selectModel: (model: string) => void;
  selectMode: (mode: "agent" | "ask") => void;
  selectReasoningEffort: (effort: string) => void;
  submit: () => void;
};

const fallbackActions: readonly ActionDescriptor[] = [
  {
    command: "zaw.composer.selectMode",
    icon: "tools",
    id: "zaw.action.composer.mode",
    menu: "chat-input",
    order: 15,
    title: "Agent mode",
  },
  {
    command: "zaw.composer.attach",
    icon: "add",
    id: "zaw.action.composer.attach",
    menu: "chat-input",
    order: 10,
    title: "Attach files",
  },
  {
    command: "zaw.composer.selectModel",
    icon: "sparkle",
    id: "zaw.action.composer.model",
    menu: "chat-input",
    order: 20,
    title: "Language model",
  },
  {
    command: "zaw.composer.selectReasoningEffort",
    icon: "settings",
    id: "zaw.action.composer.reasoningEffort",
    menu: "chat-input",
    order: 30,
    title: "Reasoning effort",
  },
  {
    command: "zaw.composer.submit",
    icon: "arrow-up",
    id: "zaw.action.composer.submit",
    menu: "chat-input",
    order: 100,
    title: "Send",
  },
];

/** Stable Agents input editor and its compact action/picker tier. */
export class AgentComposer extends Disposable {
  readonly element = createElement("div", { className: "agent-chat-composer" });
  readonly editor: HTMLTextAreaElement;
  private readonly notification = createElement("div", {
    className: "agent-composer-notification",
    role: "alert",
  });
  private readonly attachmentLane = createElement("div", {
    ariaLabel: "Attached context",
    className: "agent-composer-attachments",
    role: "list",
  });
  private readonly toolbar = createElement("div", {
    className: "agent-composer-config-toolbar",
  });
  private readonly sendHost = createElement("span", {
    className: "agent-composer-send",
  });
  private readonly attachHost = createElement("span", {
    className: "agent-composer-attach",
  });
  private readonly fileInput = createElement("input", {
    ariaLabel: "Attach files",
    className: "agent-composer-file-input",
  }) as HTMLInputElement;
  private sendAction: IconActionButton;
  private pickerStore = new DisposableStore();
  private composing = false;
  private workingBorderDuration: number | undefined;

  constructor(private readonly options: AgentComposerOptions) {
    super();
    this.editor = createElement("textarea", {
      ariaLabel: this.options.ariaLabel,
      className: "agent-composer-editor",
    }) as HTMLTextAreaElement;
    this.editor.rows = 1;
    this.fileInput.type = "file";
    this.fileInput.multiple = true;
    this.fileInput.accept = "image/*,.txt,.md,.json,.yaml,.yml,.toml,.csv";
    this.editor.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.editor.addEventListener("compositionend", () => {
      this.composing = false;
    });
    this.editor.addEventListener("input", () => {
      this.options.onChange({ draft: this.editor.value });
      this.resizeEditor();
      this.refreshSend();
    });
    this.editor.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.isComposing ||
        this.composing
      )
        return;
      event.preventDefault();
      if (!this.sendAction.element.disabled) this.options.onSubmit();
    });
    this.fileInput.addEventListener("change", () => {
      void this.attachFiles(this.fileInput.files);
      this.fileInput.value = "";
    });
    this.attachmentLane.addEventListener("keydown", (event) =>
      this.navigateAttachments(event),
    );
    this.element.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      this.element.classList.add("dragging-files");
    });
    this.element.addEventListener("dragleave", (event) => {
      if (!this.element.contains(event.relatedTarget as Node | null))
        this.element.classList.remove("dragging-files");
    });
    this.element.addEventListener("drop", (event) => {
      this.element.classList.remove("dragging-files");
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      void this.attachFiles(event.dataTransfer.files);
    });
    this.sendAction = this.createSendAction();
    this._register({ dispose: () => this.pickerStore.dispose() });
    this.observeWorkingBorderWidth();
    const attachDescriptor = this.action("zaw.action.composer.attach");
    const attach = this._register(
      new IconActionButton(this.attachHost, {
        ariaLabel: attachDescriptor.title,
        icon: attachDescriptor.icon ?? "add",
      }),
    );
    this._register(
      attach.onDidClick(() => this.runAction(attachDescriptor.command)),
    );
    this.element.append(
      this.notification,
      this.attachmentLane,
      this.editor,
      this.toolbar,
      this.fileInput,
      createElement("div", {
        className: "agent-composer-drop-overlay",
        textContent: "Attach files",
      }),
    );
    this.refreshPickers();
    this.refresh();
  }

  refresh(): void {
    const composition = this.options.composition();
    const focused = document.activeElement === this.editor;
    const selectionStart = this.editor.selectionStart;
    const selectionEnd = this.editor.selectionEnd;
    if (this.editor.value !== composition.draft) {
      this.editor.value = composition.draft;
      if (focused) {
        this.editor.focus();
        this.editor.setSelectionRange(
          Math.min(selectionStart, this.editor.value.length),
          Math.min(selectionEnd, this.editor.value.length),
        );
      }
    }
    this.editor.placeholder = this.options.placeholder();
    this.editor.disabled = Boolean(this.options.disabled?.());
    this.fileInput.disabled = Boolean(this.options.disabled?.());
    this.element.dataset.working = String(Boolean(this.options.working?.()));
    const notification = this.options.notification?.();
    this.notification.hidden = !notification;
    this.notification.dataset.kind = notification?.kind ?? "";
    this.notification.textContent = notification?.message ?? "";
    this.renderAttachments();
    this.resizeEditor();
    this.refreshSend();
  }

  refreshPickers(): void {
    this.pickerStore.dispose();
    this.pickerStore = new DisposableStore();
    const composition = this.options.composition();
    this.toolbar.replaceChildren();
    const modelDescriptor = this.action("zaw.action.composer.model");
    const modeDescriptor = this.action("zaw.action.composer.mode");
    const modeHost = createElement("span", {
      className: "agent-composer-picker-host",
    });
    const mode = this.pickerStore.add(
      new PickerAction(modeHost, {
        ariaLabel: modeDescriptor.title,
        className: "agent-mode-picker",
        icon: modeDescriptor.icon ?? "tools",
        items: [
          { label: "Agent", value: "agent" },
          { label: "Ask", value: "ask" },
        ],
        value: composition.mode === "ask" ? "ask" : "agent",
      }),
    );
    this.pickerStore.add(
      mode.onDidSelect(({ item }) =>
        this.runAction(modeDescriptor.command, item.value),
      ),
    );
    const modelHost = createElement("span", {
      className: "agent-composer-picker-host",
    });
    const modelState = this.options.modelsState?.() ?? "ready";
    const models = this.options.models();
    const modelItems =
      modelState === "loading" || modelState === "idle"
        ? [{ label: "Loading models…", value: "" }]
        : modelState === "error"
          ? [{ label: "Models unavailable", value: "" }]
          : models.length === 0
            ? [{ label: "No models available", value: "" }]
            : models.map((item) => ({
                description: item.vendor,
                label: item.name,
                value: item.id,
              }));
    const selectedModel = models.some((item) => item.id === composition.model)
      ? composition.model
      : (models[0]?.id ?? "");
    const model = this.pickerStore.add(
      new PickerAction(modelHost, {
        ariaLabel: modelDescriptor.title,
        className: "agent-model-picker",
        disabled: modelState !== "ready" || models.length === 0,
        icon: modelDescriptor.icon ?? "sparkle",
        items: modelItems,
        value: selectedModel,
      }),
    );
    this.pickerStore.add(
      model.onDidSelect(({ item }) =>
        this.runAction(modelDescriptor.command, item.value),
      ),
    );
    const selectedModelDefinition = models.find(
      (item) => item.id === selectedModel,
    );
    const effortDescriptor = this.action("zaw.action.composer.reasoningEffort");
    const effortHost = createElement("span", {
      className: "agent-composer-picker-host",
    });
    const efforts =
      selectedModelDefinition?.capabilities?.reasoningEfforts ?? [];
    const selectedEffort = efforts.includes(composition.reasoningEffort)
      ? composition.reasoningEffort
      : (efforts[0] ?? "");
    if (
      modelState === "ready" &&
      (composition.model !== selectedModel ||
        composition.reasoningEffort !== selectedEffort)
    )
      queueMicrotask(() =>
        this.options.onChange({
          model: selectedModel,
          reasoningEffort: selectedEffort,
        }),
      );
    const effort = this.pickerStore.add(
      new PickerAction(effortHost, {
        ariaLabel: effortDescriptor.title,
        className: "agent-reasoning-picker",
        disabled:
          !selectedModelDefinition?.capabilities?.reasoning ||
          efforts.length === 0,
        icon: effortDescriptor.icon ?? "settings",
        items: efforts.length
          ? efforts.map((value) => ({
              label: this.reasoningEffortLabel(value),
              value,
            }))
          : [{ label: "No reasoning", value: "" }],
        value: selectedEffort,
      }),
    );
    this.pickerStore.add(
      effort.onDidSelect(({ item }) => {
        if (!composition.model && selectedModel)
          this.options.onChange({ model: selectedModel });
        this.runAction(effortDescriptor.command, item.value);
      }),
    );
    const spacer = createElement("span", {
      className: "agent-composer-spacer",
    });
    this.toolbar.append(
      this.attachHost,
      modeHost,
      modelHost,
      effortHost,
      spacer,
      this.sendHost,
    );
  }

  private createSendAction(): IconActionButton {
    const descriptor = this.action("zaw.action.composer.submit");
    const action = this._register(
      new IconActionButton(this.sendHost, {
        ariaLabel: descriptor.title,
        className: "agent-primary-send-action",
        icon: descriptor.icon ?? "arrow-up",
      }),
    );
    this._register(action.onDidClick(() => this.runAction(descriptor.command)));
    return action;
  }

  private action(id: string): ActionDescriptor {
    return (
      this.options.actions
        ?.actions("chat-input")
        .find((entry) => entry.id === id) ??
      fallbackActions.find((entry) => entry.id === id)!
    );
  }

  private runAction(command: string, value?: string): void {
    const context: ComposerActionContext = {
      attach: () => this.fileInput.click(),
      selectModel: (model) => {
        this.options.onChange({ model, reasoningEffort: "" });
        queueMicrotask(() => this.refreshPickers());
      },
      selectMode: (mode) => this.options.onChange({ mode }),
      selectReasoningEffort: (reasoningEffort) =>
        this.options.onChange({ reasoningEffort }),
      submit: () => this.options.onSubmit(),
    };
    if (this.options.commands)
      void this.options.commands.executeCommand(command, context, value);
    else if (command === "zaw.composer.attach") context.attach();
    else if (command === "zaw.composer.selectModel")
      context.selectModel(value ?? "");
    else if (command === "zaw.composer.selectMode")
      context.selectMode(value === "ask" ? "ask" : "agent");
    else if (command === "zaw.composer.selectReasoningEffort")
      context.selectReasoningEffort(value ?? "");
    else context.submit();
  }

  private reasoningEffortLabel(effort: string): string {
    return (
      {
        low: "Low",
        medium: "Medium",
        high: "High",
        xhigh: "Extra high",
      }[effort] ?? effort
    );
  }

  private refreshSend(): void {
    const working = Boolean(this.options.working?.());
    const cancellable = this.options.workingAction === "cancel";
    this.sendAction.setWorking(working && !cancellable);
    this.sendAction.setIcon(working && cancellable ? "debug-stop" : "arrow-up");
    this.sendAction.element.setAttribute(
      "aria-label",
      working
        ? cancellable
          ? "Stop generating"
          : "Creating session"
        : this.action("zaw.action.composer.submit").title,
    );
    this.sendAction.setDisabled(
      Boolean(this.options.disabled?.()) ||
        (!working &&
          !this.editor.value.trim() &&
          this.options.composition().attachments.length === 0),
    );
  }

  /** Keeps the working border's perceived travel speed steady as the input resizes. */
  private observeWorkingBorderWidth(): void {
    const update = () => this.updateWorkingBorderDuration();
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(this.element);
    this._register({ dispose: () => observer.disconnect() });
  }

  private updateWorkingBorderDuration(): void {
    const width = this.element.getBoundingClientRect().width;
    if (width <= 0) return;
    const duration = Math.min(
      2.5,
      Math.max(1.4, 0.55 + 0.075 * Math.sqrt(Math.max(50, width))),
    );
    if (
      this.workingBorderDuration !== undefined &&
      Math.abs(this.workingBorderDuration - duration) < 0.05
    )
      return;
    this.workingBorderDuration = duration;
    this.element.style.setProperty(
      "--zaw-agent-composer-working-border-duration",
      `${duration.toFixed(2)}s`,
    );
    if (this.element.dataset.working !== "true") return;
    this.element.classList.add("agent-composer-working-border-restart");
    requestAnimationFrame(() =>
      this.element.classList.remove("agent-composer-working-border-restart"),
    );
  }

  private renderAttachments(): void {
    const attachments = this.options.composition().attachments;
    this.attachmentLane.hidden = attachments.length === 0;
    this.attachmentLane.replaceChildren(
      ...attachments.map((attachment, index) => {
        const item = createElement("span", {
          className: "agent-composer-attachment-item",
          role: "listitem",
        });
        const pill = createElement("button", {
          ariaLabel: `Remove ${attachment.label}`,
          className: "agent-composer-attachment",
        });
        pill.type = "button";
        pill.title = attachment.label;
        pill.dataset.attachmentIndex = String(index);
        pill.append(
          createElement("span", {
            className: `codicon codicon-${
              attachment.displayKind === "image" ? "file-media" : "file"
            }`,
          }),
          createElement("span", {
            className: "agent-composer-attachment-label",
            textContent: attachment.label,
          }),
          createElement("span", {
            className: "codicon codicon-close agent-composer-attachment-remove",
          }),
        );
        pill.addEventListener("click", () => this.removeAttachment(index));
        item.append(pill);
        return item;
      }),
    );
  }

  private removeAttachment(index: number): void {
    const attachments = [...this.options.composition().attachments];
    attachments.splice(index, 1);
    this.options.onChange({ attachments });
    this.renderAttachments();
    const pills = this.attachmentLane.querySelectorAll<HTMLButtonElement>(
      ".agent-composer-attachment",
    );
    pills[Math.min(index, pills.length - 1)]?.focus();
    if (!pills.length) this.editor.focus();
    this.refreshSend();
  }

  private navigateAttachments(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const pills = Array.from(
      this.attachmentLane.querySelectorAll<HTMLButtonElement>(
        ".agent-composer-attachment",
      ),
    );
    const index = pills.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || pills.length < 2) return;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    pills[(index + direction + pills.length) % pills.length].focus();
    event.preventDefault();
  }

  private async attachFiles(files: FileList | null): Promise<void> {
    if (!files?.length || this.options.disabled?.()) return;
    const next = await Promise.all(Array.from(files).map(readAttachment));
    this.options.onChange({
      attachments: [...this.options.composition().attachments, ...next],
    });
    this.renderAttachments();
    this.refreshSend();
  }

  private resizeEditor(): void {
    this.editor.style.height = "0";
    this.editor.style.height = `${Math.min(180, Math.max(52, this.editor.scrollHeight))}px`;
  }
}

export async function readAttachment(
  file: File,
): Promise<ChatComposition["attachments"][number]> {
  const image = file.type.startsWith("image/");
  return {
    contentType: file.type || "text/plain",
    data: await readBase64(file),
    displayKind: image ? "image" : "document",
    label: file.name,
    type: "embeddedResource",
  };
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataURL = String(reader.result ?? "");
      const separator = dataURL.indexOf(",");
      if (separator < 0) {
        reject(new Error("FileReader returned an invalid data URL"));
        return;
      }
      resolve(dataURL.slice(separator + 1));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
