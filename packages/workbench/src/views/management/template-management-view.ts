import type { Template } from "@zaw/protocol";
import {
  ButtonWidget,
  Emitter,
  PrimaryButtonWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";

export type TemplateManagementViewOptions = {
  templates: Template[];
};

export class TemplateManagementView extends Widget {
  private readonly _onDidAddTemplate = this._register(new Emitter<void>());
  private readonly _onDidEditTemplate = this._register(new Emitter<string>());
  private readonly _onDidRequestDeleteTemplate = this._register(
    new Emitter<string>(),
  );
  readonly onDidAddTemplate = this._onDidAddTemplate.event;
  readonly onDidEditTemplate = this._onDidEditTemplate.event;
  readonly onDidRequestDeleteTemplate = this._onDidRequestDeleteTemplate.event;

  constructor(
    root: HTMLElement,
    private readonly options: TemplateManagementViewOptions,
  ) {
    super(root);
    const add = createElement("span");
    const addButton = new PrimaryButtonWidget(add, {
      icon: "add",
      label: "Add template",
      text: "Add Template",
    });
    addButton.onDidClick(
      () => this._onDidAddTemplate.fire(),
      undefined,
      this.disposables,
    );
    const section = createElement("section", {
      ariaLabel: "Templates",
      className: "management-resource-view",
    });
    const header = createElement("header");
    const copy = createElement("div");
    append(
      copy,
      createElement("h2", { textContent: "Templates" }),
      createElement("p", {
        textContent: "Immutable Git commits and verified Tar archives.",
      }),
    );
    append(header, copy, ...Array.from(add.childNodes));
    const list = createElement("div", {
      className: "management-resource-list",
    });
    if (this.options.templates.length)
      this.options.templates.forEach((template) =>
        list.append(this.renderTemplate(template)),
      );
    else
      list.append(
        createElement("p", {
          className: "settings-empty",
          textContent: "No templates",
        }),
      );
    append(section, header, list);
    this.root.replaceChildren(section);
  }

  private renderTemplate(template: Template) {
    const edit = createElement("span");
    const editButton = new ButtonWidget(edit, {
      icon: "edit",
      label: `Edit ${template.name}`,
      text: "Edit",
      value: template.id,
    });
    editButton.onDidClick(
      () => this._onDidEditTemplate.fire(template.id),
      undefined,
      this.disposables,
    );
    const remove = createElement("span");
    const removeButton = new ButtonWidget(remove, {
      icon: "trash",
      label: `Delete ${template.name}`,
      value: template.id,
    });
    removeButton.onDidClick(
      () => this._onDidRequestDeleteTemplate.fire(template.id),
      undefined,
      this.disposables,
    );
    const source = template.source;
    const pin =
      source.kind === "git" ? source.commit || source.ref : source.sha256;
    const article = createElement("article", {
      className: "management-resource-card",
    });
    const header = createElement("header");
    const title = createElement("div");
    append(
      title,
      createElement("strong", { textContent: template.name }),
      createElement("small", {
        textContent: template.description || "No description",
      }),
    );
    const actions = createElement("span");
    append(
      actions,
      ...Array.from(edit.childNodes),
      ...Array.from(remove.childNodes),
    );
    append(header, title, actions);
    const list = createElement("dl");
    appendDefinition(list, "Source", `${source.kind} · ${source.url}`);
    appendDefinition(list, "Fixed revision", pin || "Resolved on save");
    appendDefinition(list, "Directory", source.directory || ".");
    appendDefinition(list, "Credential", source.credentialId || "None");
    append(article, header, list);
    return article;
  }
}

function appendDefinition(list: HTMLElement, term: string, value: string) {
  append(
    list,
    createElement("dt", { textContent: term }),
    createElement("dd", { textContent: value }),
  );
}
