import type { Credential } from "@zaw/protocol";
import {
  ButtonWidget,
  InputWidget,
  PrimaryButtonWidget,
  QuickPickWidget,
  SelectWidget,
  TextAreaWidget,
  Widget,
  append,
  createElement,
  type IDisposable,
} from "@zaw/ui";
import type {
  IManagementSheetContributionRegistry,
  ManagementSheetAction,
  ManagementSheetContributionContext,
} from "./management-sheet-contribution-registry";

class ManagementSheetContentWidget extends Widget {
  constructor(
    root: HTMLElement,
    private readonly context: ManagementSheetContributionContext,
    render: (widget: ManagementSheetContentWidget) => Node,
  ) {
    super(root);
    this.root.replaceChildren(render(this));
  }

  emit(action: ManagementSheetAction) {
    this.context.emitAction(action);
  }

  workspacePicker() {
    const rows = createElement("div");
    const picker = new QuickPickWidget(
      rows,
      this.context.workspaces.map((workspace) => ({
        description:
          workspace.agentHostState === "online" ? "Ready" : "Offline",
        id: workspace.id,
        label: workspace.name,
      })),
    );
    picker.onDidSelect(
      ({ id }) => this.emit({ kind: "pickWorkspace", value: id }),
      undefined,
      this.disposables,
    );
    const content = createElement("div");
    if (this.context.workspaces.length) {
      content.append(...Array.from(rows.childNodes));
    } else {
      content.append(
        createElement("p", {
          className: "settings-empty",
          textContent: "No workspace is available.",
        }),
      );
    }
    const actions = createElement("div", {
      className: "sheet-confirm-actions",
    });
    if (this.context.templates.length) {
      actions.append(
        this.primaryButton("Create Workspace", () =>
          this.emit({ kind: "startWorkspaceCreate" }),
        ),
      );
    }
    content.append(actions);
    return content;
  }

  workspaceSheet() {
    const templates = this.context.templates.map((template) => ({
      label: template.name,
      value: template.id,
    }));
    return this.form(
      [
        this.inputLabel("Name", { name: "workspace-name", required: true }),
        this.selectLabel("Template", {
          name: "workspace-template",
          options: templates,
          value: templates[0]?.value,
        }),
      ],
      [
        this.button("Cancel", () => this.emit({ kind: "close" })),
        this.primaryButton("Create Workspace", () =>
          this.emit({ kind: "saveWorkspace" }),
        ),
      ],
    );
  }

  templateSourcePicker() {
    const content = createElement("div");
    content.append(
      createElement("p", {
        className: "sheet-description",
        textContent:
          "Choose an immutable template source. Git refs and archive checksums are resolved before save.",
      }),
    );
    const picker = createElement("div");
    const sourcePicker = new QuickPickWidget(picker, [
      {
        description: "Pin a ref to a commit for reproducible builds.",
        id: "git",
        label: "Git repository",
      },
      {
        description: "Download, validate and pin an archive checksum.",
        id: "tar",
        label: "Tar URL",
      },
    ]);
    sourcePicker.onDidSelect(
      ({ id }) =>
        this.emit({ kind: "chooseTemplateSource", value: id as "git" | "tar" }),
      undefined,
      this.disposables,
    );
    content.append(...Array.from(picker.childNodes));
    return content;
  }

  templateSheet() {
    const editing = this.context.editingTemplate;
    const source = editing?.source;
    const fields: Node[] = [
      createElement("p", {
        className: "sheet-description",
        textContent:
          this.context.templateKind === "git"
            ? "Git sources are resolved to a fixed commit."
            : "Tar archives are verified before a snapshot is created.",
      }),
      this.inputLabel("Name", {
        name: "template-name",
        required: true,
        value: editing?.name,
      }),
      this.inputLabel("Description", {
        name: "template-description",
        value: editing?.description,
      }),
    ];
    if (this.context.templateKind === "git") {
      fields.push(
        this.inputLabel("Repository URL", {
          name: "template-url",
          placeholder: "https://example.com/team/template.git",
          value: source?.url,
        }),
        this.inputLabel("Ref", {
          name: "template-ref",
          value: source?.ref ?? "main",
        }),
        this.inputLabel("Directory", {
          name: "template-directory",
          placeholder: "optional/subdirectory",
          value: source?.directory,
        }),
      );
    } else {
      fields.push(
        this.inputLabel("Archive URL", {
          name: "template-url",
          placeholder: "https://example.com/template.tar.gz",
          value: source?.url,
        }),
        this.inputLabel("SHA-256", {
          name: "template-sha256",
          placeholder: "Optional: calculated and pinned when empty",
          value: source?.sha256,
        }),
        this.selectLabel("Format", {
          name: "template-format",
          options: [
            { label: "Auto detect", value: "" },
            { label: "tar", value: "tar" },
            { label: "tar.gz", value: "tar.gz" },
            { label: "tar.zst", value: "tar.zst" },
          ],
          value: source?.format,
        }),
      );
    }
    fields.push(
      this.selectLabel("System credential", {
        name: "template-credential",
        options: [
          { label: "None", value: "" },
          ...this.context.credentials.map((item) => ({
            label: item.name,
            value: item.id,
          })),
        ],
        value: source?.credentialId,
      }),
    );
    return this.form(fields, [
      this.button("Cancel", () => this.emit({ kind: "close" })),
      this.primaryButton(editing ? "Save Changes" : "Save Template", () =>
        this.emit({ kind: "saveTemplate" }),
      ),
    ]);
  }

  credentialSheet() {
    const editing = this.context.editingCredential;
    const metadata = editing?.metadata ?? {};
    const kind = createElement("div");
    const kindSelect = new SelectWidget(kind, {
      ariaLabel: "Credential type",
      options: [
        { label: "Token", value: "token" },
        { label: "Username and password", value: "username_password" },
        { label: "SSH key", value: "ssh_key" },
      ],
      value: this.context.credentialKind,
    });
    kindSelect.onDidSelect(
      ({ value }) =>
        this.emit({
          kind: "setCredentialKind",
          value: value as Credential["kind"],
        }),
      undefined,
      this.disposables,
    );
    const kindLabel = createElement("label");
    append(
      kindLabel,
      document.createTextNode("Type "),
      ...Array.from(kind.childNodes),
    );
    const fields: Node[] = [
      createElement("p", {
        className: "sheet-description",
        textContent:
          "Sensitive values are sent only to the secret manager; the control plane stores metadata.",
      }),
      this.inputLabel("Name", {
        name: "credential-name",
        required: true,
        value: editing?.name,
      }),
      kindLabel,
    ];
    if (this.context.credentialKind === "token") {
      fields.push(
        this.inputLabel("Token", {
          autocomplete: "off",
          name: "credential-token",
          placeholder: "Leave blank to keep the current token",
          type: "password",
          value: "",
        }),
      );
    } else if (this.context.credentialKind === "username_password") {
      fields.push(
        this.inputLabel("Username", {
          name: "credential-username",
          value: metadata.username,
        }),
        this.inputLabel("Password", {
          autocomplete: "off",
          name: "credential-password",
          placeholder: "Leave blank to keep the current password",
          type: "password",
          value: "",
        }),
      );
    } else {
      fields.push(
        this.inputLabel("Username", {
          name: "credential-username",
          value: metadata.username,
        }),
        this.inputLabel("Public key", {
          name: "credential-public-key",
          value: metadata.publicKey,
        }),
        this.inputLabel("Fingerprint", {
          name: "credential-fingerprint",
          value: metadata.fingerprint,
        }),
        this.textAreaLabel("Private key", {
          name: "credential-private-key",
          placeholder: "Leave blank to keep the current private key",
        }),
      );
    }
    return this.form(fields, [
      this.button("Cancel", () => this.emit({ kind: "close" })),
      this.primaryButton(editing ? "Save Changes" : "Save Credential", () =>
        this.emit({ kind: "saveCredential" }),
      ),
    ]);
  }

  confirmContent(parts: string[], actions: Node[]) {
    const content = createElement("div");
    const description = createElement("p", { className: "sheet-description" });
    if (parts.length === 1) {
      description.textContent = parts[0];
    } else {
      append(
        description,
        document.createTextNode(parts[0]),
        createElement("strong", { textContent: parts[1] }),
        document.createTextNode(parts[2] ?? ""),
      );
    }
    const actionRow = createElement("div", {
      className: "sheet-confirm-actions",
    });
    actionRow.append(...actions);
    append(content, description, actionRow);
    return content;
  }

  form(fields: Node[], actions: Node[]) {
    const form = createElement("form", { className: "sheet-form" });
    this.listen(form, "submit", (event) => event.preventDefault());
    const footer = createElement("footer");
    footer.append(...actions);
    append(form, ...fields, footer);
    return form;
  }

  inputLabel(
    text: string,
    options: ConstructorParameters<typeof InputWidget>[1],
  ) {
    const label = createElement("label");
    const input = createElement("div");
    new InputWidget(input, options);
    append(
      label,
      document.createTextNode(text),
      ...Array.from(input.childNodes),
    );
    return label;
  }

  textAreaLabel(
    text: string,
    options: ConstructorParameters<typeof TextAreaWidget>[1],
  ) {
    const label = createElement("label");
    const input = createElement("div");
    new TextAreaWidget(input, options);
    append(
      label,
      document.createTextNode(text),
      ...Array.from(input.childNodes),
    );
    return label;
  }

  selectLabel(
    text: string,
    options: ConstructorParameters<typeof SelectWidget>[1],
  ) {
    const label = createElement("label");
    const input = createElement("div");
    new SelectWidget(input, options);
    append(
      label,
      document.createTextNode(text),
      ...Array.from(input.childNodes),
    );
    return label;
  }

  button(text: string, onDidClick?: () => void, className?: string) {
    const root = createElement("span");
    const button = new ButtonWidget(root, {
      className,
      label: text,
      text,
    });
    if (onDidClick) button.onDidClick(onDidClick, undefined, this.disposables);
    return root.firstElementChild ?? root;
  }

  primaryButton(text: string, onDidClick?: () => void) {
    const root = createElement("span");
    const button = new PrimaryButtonWidget(root, { label: text, text });
    if (onDidClick) button.onDidClick(onDidClick, undefined, this.disposables);
    return root.firstElementChild ?? root;
  }
}

export function registerBuiltinManagementSheetContributions(
  registry: IManagementSheetContributionRegistry,
): IDisposable[] {
  const sheet = (
    root: HTMLElement,
    context: ManagementSheetContributionContext,
    render: (widget: ManagementSheetContentWidget) => Node,
  ) => new ManagementSheetContentWidget(root, context, render);

  return [
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => view.workspacePicker()),
      id: "workspace-picker",
      order: 10,
      title: "Choose a workspace",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => view.workspaceSheet()),
      id: "workspace",
      order: 20,
      title: "Create workspace",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => view.templateSourcePicker()),
      id: "template-source",
      order: 30,
      title: "Add Template",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => view.templateSheet()),
      id: "template",
      order: 40,
      title: "Template",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => view.credentialSheet()),
      id: "credential",
      order: 50,
      title: "System Credential",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) =>
          view.confirmContent(
            [
              "Restore ",
              context.pendingRevertPath,
              " from Git? Its unstaged and staged changes will be discarded.",
            ],
            [
              view.button("Cancel", () => view.emit({ kind: "close" })),
              view.button(
                "Restore File",
                () => view.emit({ kind: "revertChange" }),
                "danger-action",
              ),
            ],
          ),
        ),
      id: "confirm-revert",
      order: 60,
      title: "Restore file",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => {
          const template = context.templates.find(
            (item) => item.id === context.pendingTemplateDeleteID,
          );
          return view.confirmContent(
            [
              "Delete ",
              template?.name ?? "this template",
              "? Existing Workspaces keep their pinned source snapshots and prevent this deletion.",
            ],
            [
              view.button("Cancel", () => view.emit({ kind: "close" })),
              view.button(
                "Delete Template",
                () => view.emit({ kind: "deleteTemplate" }),
                "danger-action",
              ),
            ],
          );
        }),
      id: "confirm-template-delete",
      order: 70,
      title: "Delete template",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) =>
          view.confirmContent(
            ["Discard the unsaved changes in this management form?"],
            [
              view.button("Continue Editing", () =>
                view.emit({ kind: "continueEditing" }),
              ),
              view.button(
                "Discard Changes",
                () => view.emit({ kind: "discardChanges" }),
                "danger-action",
              ),
            ],
          ),
        ),
      id: "confirm-discard",
      order: 80,
      title: "Unsaved changes",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => {
          const credential = context.credentials.find(
            (item) => item.id === context.pendingCredentialDeleteID,
          );
          return view.confirmContent(
            [
              "Delete ",
              credential?.name ?? "this credential",
              "? Credentials referenced by a Template or Workspace snapshot cannot be deleted.",
            ],
            [
              view.button("Cancel", () => view.emit({ kind: "close" })),
              view.button(
                "Delete Credential",
                () => view.emit({ kind: "deleteCredential" }),
                "danger-action",
              ),
            ],
          );
        }),
      id: "confirm-credential-delete",
      order: 90,
      title: "Delete credential",
    }),
    registry.register({
      factory: (root, context) =>
        sheet(root, context, (view) => {
          const workspace = context.workspaces.find(
            (item) => item.id === context.pendingWorkspaceID,
          );
          return view.confirmContent(
            [
              "Stop ",
              workspace?.name ?? "this workspace",
              "? The VM is retained and can be started again; this does not destroy it.",
            ],
            [
              view.button("Cancel", () => view.emit({ kind: "close" })),
              view.button(
                "Stop Workspace",
                () => view.emit({ kind: "stopWorkspace" }),
                "danger-action",
              ),
            ],
          );
        }),
      id: "confirm-workspace-stop",
      order: 100,
      title: "Stop workspace",
    }),
  ];
}
