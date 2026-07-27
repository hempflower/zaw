import {
  ButtonWidget,
  Emitter,
  InputWidget,
  SelectWidget,
  TextAreaWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";
import type { ChatComposition } from "../../services/chat-session";

export type ChatComposerOptions = {
  activeTurn: boolean;
  composition: ChatComposition;
  enabled: boolean;
  models: Array<{ id: string; name: string }>;
};

export class ChatComposerWidget extends Widget {
  private readonly _onDidCancelTurn = this._register(new Emitter<void>());
  private readonly _onDidChangeAgent = this._register(new Emitter<string>());
  private readonly _onDidChangeApprovalMode = this._register(
    new Emitter<"allow" | "ask">(),
  );
  private readonly _onDidChangeDraft = this._register(new Emitter<string>());
  private readonly _onDidChangeModel = this._register(new Emitter<string>());
  private readonly _onDidChooseAttachments = this._register(
    new Emitter<File[]>(),
  );
  private readonly _onDidRemoveAttachment = this._register(
    new Emitter<number>(),
  );
  private readonly _onDidSendMessage = this._register(new Emitter<void>());
  readonly onDidCancelTurn = this._onDidCancelTurn.event;
  readonly onDidChangeAgent = this._onDidChangeAgent.event;
  readonly onDidChangeApprovalMode = this._onDidChangeApprovalMode.event;
  readonly onDidChangeDraft = this._onDidChangeDraft.event;
  readonly onDidChangeModel = this._onDidChangeModel.event;
  readonly onDidChooseAttachments = this._onDidChooseAttachments.event;
  readonly onDidRemoveAttachment = this._onDidRemoveAttachment.event;
  readonly onDidSendMessage = this._onDidSendMessage.event;

  constructor(
    root: HTMLElement,
    private readonly options: ChatComposerOptions,
  ) {
    super(root);
    const { activeTurn, composition, enabled, models } = this.options;
    const composer = createElement("div", { className: "chat-composer" });
    if (composition.attachments.length > 0) {
      const attachments = createElement("div", {
        className: "composer-attachments",
      });
      composition.attachments.forEach((attachment, index) => {
        const item = createElement("span", {
          className: "composer-attachment",
        });
        const remove = createElement("span");
        const removeButton = new ButtonWidget(remove, {
          icon: "close",
          label: `Remove ${attachment.label}`,
          value: String(index),
        });
        removeButton.onDidClick(
          () => this._onDidRemoveAttachment.fire(index),
          undefined,
          this.disposables,
        );
        append(
          item,
          createElement("span", { className: "codicon codicon-file-media" }),
          document.createTextNode(attachment.label),
          ...Array.from(remove.childNodes),
        );
        attachments.append(item);
      });
      composer.append(attachments);
    }
    const input = createElement("div");
    const textArea = new TextAreaWidget(input, {
      ariaLabel: "Message the agent",
      className: "composer-input",
      disabled: !enabled,
      placeholder: "Message the agent",
      value: composition.draft,
    });
    textArea.onDidInput(
      ({ value }) => this._onDidChangeDraft.fire(value),
      undefined,
      this.disposables,
    );
    const attachmentInput = createElement("div");
    const fileInput = new InputWidget(attachmentInput, {
      ariaLabel: "Choose chat attachments",
      className: "composer-file-input",
      disabled: !enabled,
      multiple: true,
      type: "file",
    });
    fileInput.onDidChange(
      ({ event }) => {
        this._onDidChooseAttachments.fire(
          Array.from((event.target as HTMLInputElement).files ?? []),
        );
      },
      undefined,
      this.disposables,
    );
    const agent = createElement("div");
    const agentSelect = new SelectWidget(agent, {
      ariaLabel: "Agent",
      disabled: !enabled,
      options: [{ label: "Copilot", value: "copilot" }],
      value: composition.agent,
    });
    agentSelect.onDidSelect(
      ({ value }) => this._onDidChangeAgent.fire(value),
      undefined,
      this.disposables,
    );
    const model = createElement("div");
    const modelSelect = new SelectWidget(model, {
      ariaLabel: "Model",
      disabled: !enabled,
      options: [
        { label: "Server default", value: "" },
        ...models.map((item) => ({ label: item.name, value: item.id })),
      ],
      value: composition.model,
    });
    modelSelect.onDidSelect(
      ({ value }) => this._onDidChangeModel.fire(value),
      undefined,
      this.disposables,
    );
    const approvalMode = createElement("div");
    const approvalModeSelect = new SelectWidget(approvalMode, {
      ariaLabel: "Approval mode",
      disabled: !enabled,
      options: [
        { label: "Ask", value: "ask" },
        { label: "Allow this session", value: "allow" },
      ],
      value: composition.approvalMode,
    });
    approvalModeSelect.onDidSelect(
      ({ value }) =>
        this._onDidChangeApprovalMode.fire(value === "allow" ? "allow" : "ask"),
      undefined,
      this.disposables,
    );
    composer.append(...Array.from(input.childNodes));
    const toolbar = createElement("div", { className: "composer-toolbar" });
    const attach = createElement("span");
    const attachButton = new ButtonWidget(attach, {
      disabled: !enabled,
      icon: "attach",
      label: "Attach files",
    });
    attachButton.onDidClick(
      () => attachmentInput.querySelector<HTMLInputElement>("input")?.click(),
      undefined,
      this.disposables,
    );
    const label = (icon: string, child: HTMLElement) => {
      const wrapper = createElement("label", { className: "composer-select" });
      append(
        wrapper,
        createElement("span", { className: `codicon codicon-${icon}` }),
        ...Array.from(child.childNodes),
      );
      return wrapper;
    };
    const send = createElement("span");
    const sendButton = new ButtonWidget(
      send,
      activeTurn
        ? {
            icon: "debug-stop",
            label: "Cancel response",
            text: "Stop",
          }
        : {
            className: "send-message",
            disabled: !enabled || composition.draft.trim() === "",
            icon: "send",
            label: "Send message",
            variant: "primary",
          },
    );
    sendButton.onDidClick(
      () =>
        activeTurn
          ? this._onDidCancelTurn.fire()
          : this._onDidSendMessage.fire(),
      undefined,
      this.disposables,
    );
    append(
      toolbar,
      ...Array.from(attachmentInput.childNodes),
      ...Array.from(attach.childNodes),
      label("sparkle", agent),
      label("hubot", model),
      label("shield", approvalMode),
      createElement("span", { className: "composer-spacer" }),
      ...Array.from(send.childNodes),
    );
    composer.append(toolbar);
    this.root.replaceChildren(composer);
  }
}
