import { Widget, createElement } from "@zaw/ui";

export type ToolCallWidgetOptions = {
  detail: string;
  state: string;
  title: string;
};

export class ToolCallWidget extends Widget {
  constructor(
    root: HTMLElement,
    private readonly options: ToolCallWidgetOptions,
  ) {
    super(root);
    const article = createElement("article", {
      className: "session-event tool-event",
    });
    const header = createElement("header");
    header.append(
      createElement("span", { className: "codicon codicon-tools" }),
      createElement("span", { textContent: this.options.title }),
      createElement("span", {
        className: "tool-state",
        textContent: this.options.state,
      }),
    );
    article.append(header);
    if (this.options.detail) {
      article.append(
        createElement("pre", { textContent: this.options.detail }),
      );
    }
    this.root.replaceChildren(article);
  }
}
