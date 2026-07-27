import { ButtonWidget, Emitter, Widget, append, createElement } from "@zaw/ui";

export type ApprovalWidgetOptions = {
  actionValue: string;
  detail: string;
  onDidConfirm?: (value: string, approved: boolean) => void;
  state: "approved" | "denied" | "pending";
  title: string;
};

export class ApprovalWidget extends Widget {
  private readonly _onDidConfirm = this._register(
    new Emitter<{ value: string; approved: boolean }>(),
  );
  readonly onDidConfirm = this._onDidConfirm.event;

  constructor(
    root: HTMLElement,
    private readonly options: ApprovalWidgetOptions,
  ) {
    super(root);
    const pending = this.options.state === "pending";
    const article = createElement("article", {
      className: "session-event approval-event",
    });
    const header = createElement("header");
    append(
      header,
      createElement("span", { className: "codicon codicon-shield" }),
      createElement("span", { textContent: this.options.title }),
    );
    const footer = createElement("footer");
    if (pending) {
      const allow = createElement("span");
      const allowButton = new ButtonWidget(allow, {
        label: "Allow tool call",
        text: "Allow",
        value: this.options.actionValue,
        variant: "primary",
      });
      allowButton.onDidClick(
        () => {
          this.options.onDidConfirm?.(this.options.actionValue, true);
          this._onDidConfirm.fire({
            value: this.options.actionValue,
            approved: true,
          });
        },
        undefined,
        this.disposables,
      );
      const deny = createElement("span");
      const denyButton = new ButtonWidget(deny, {
        label: "Deny tool call",
        text: "Deny",
        value: this.options.actionValue,
      });
      denyButton.onDidClick(
        () => {
          this.options.onDidConfirm?.(this.options.actionValue, false);
          this._onDidConfirm.fire({
            value: this.options.actionValue,
            approved: false,
          });
        },
        undefined,
        this.disposables,
      );
      append(
        footer,
        ...Array.from(allow.childNodes),
        ...Array.from(deny.childNodes),
      );
    } else {
      footer.append(
        createElement("span", {
          className: "approval-state",
          textContent: this.options.state,
        }),
      );
    }
    append(
      article,
      header,
      createElement("pre", { textContent: this.options.detail }),
      footer,
    );
    this.root.replaceChildren(article);
  }
}
