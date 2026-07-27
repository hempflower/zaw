import type { Credential, Template } from "@zaw/protocol";
import {
  ButtonWidget,
  Emitter,
  PrimaryButtonWidget,
  Widget,
  append,
  createElement,
} from "@zaw/ui";

export type CredentialManagementViewOptions = {
  credentials: Credential[];
  templates: Template[];
};

export class CredentialManagementView extends Widget {
  private readonly _onDidAddCredential = this._register(new Emitter<void>());
  private readonly _onDidEditCredential = this._register(new Emitter<string>());
  private readonly _onDidRequestDeleteCredential = this._register(
    new Emitter<string>(),
  );
  readonly onDidAddCredential = this._onDidAddCredential.event;
  readonly onDidEditCredential = this._onDidEditCredential.event;
  readonly onDidRequestDeleteCredential =
    this._onDidRequestDeleteCredential.event;

  constructor(
    root: HTMLElement,
    private readonly options: CredentialManagementViewOptions,
  ) {
    super(root);
    const add = createElement("span");
    const addButton = new PrimaryButtonWidget(add, {
      icon: "add",
      label: "Add credential",
      text: "Add Credential",
    });
    addButton.onDidClick(
      () => this._onDidAddCredential.fire(),
      undefined,
      this.disposables,
    );
    const section = createElement("section", {
      ariaLabel: "Credentials",
      className: "management-resource-view",
    });
    const header = createElement("header");
    const copy = createElement("div");
    append(
      copy,
      createElement("h2", { textContent: "System Credentials" }),
      createElement("p", {
        textContent:
          "Fixed secrets are stored in the Secret Manager and are not rotated.",
      }),
    );
    append(header, copy, ...Array.from(add.childNodes));
    const list = createElement("div", {
      className: "management-resource-list",
    });
    if (this.options.credentials.length)
      this.options.credentials.forEach((credential) =>
        list.append(this.renderCredential(credential)),
      );
    else
      list.append(
        createElement("p", {
          className: "settings-empty",
          textContent: "No system credentials",
        }),
      );
    append(section, header, list);
    this.root.replaceChildren(section);
  }

  private renderCredential(credential: Credential) {
    const edit = createElement("span");
    const editButton = new ButtonWidget(edit, {
      icon: "edit",
      label: `Edit ${credential.name}`,
      text: "Edit",
      value: credential.id,
    });
    editButton.onDidClick(
      () => this._onDidEditCredential.fire(credential.id),
      undefined,
      this.disposables,
    );
    const remove = createElement("span");
    const removeButton = new ButtonWidget(remove, {
      icon: "trash",
      label: `Delete ${credential.name}`,
      value: credential.id,
    });
    removeButton.onDidClick(
      () => this._onDidRequestDeleteCredential.fire(credential.id),
      undefined,
      this.disposables,
    );
    const metadata = Object.entries(credential.metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    const usedBy = this.options.templates
      .filter((template) => template.source.credentialId === credential.id)
      .map((template) => template.name)
      .join(", ");
    const article = createElement("article", {
      className: "management-resource-card",
    });
    const header = createElement("header");
    const title = createElement("div");
    append(
      title,
      createElement("strong", { textContent: credential.name }),
      createElement("small", { textContent: credential.kind }),
    );
    const actions = createElement("span");
    append(
      actions,
      ...Array.from(edit.childNodes),
      ...Array.from(remove.childNodes),
    );
    append(header, title, actions);
    const list = createElement("dl");
    appendDefinition(list, "Metadata", metadata || "None");
    appendDefinition(list, "Used by", usedBy || "No current Template");
    appendDefinition(list, "Secret policy", "Fixed; no automatic rotation");
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
