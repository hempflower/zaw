import type { Credential, Workspace } from "@zaw/protocol";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  ButtonWidget,
  CheckboxWidget,
  Disposable,
  DisposableStore,
  IconActionButton,
  InputWidget,
  PrimaryButtonWidget,
  SelectWidget,
  createElement,
  type IDisposable,
} from "@zaw/ui";
import { inject, injectable } from "inversify";
import { ICommandService } from "../../platform/commands/commands";
import { INotificationService } from "../../platform/notifications/notifications";
import { IOverlayService } from "../../platform/overlay/overlay-service";
import {
  IThemeService,
  type ColorTheme,
} from "../../platform/theme/theme-service";
import {
  ViewRoot,
  type IWorkbenchView,
} from "../../services/workbench-view-registry";
import { IWorkspaceService } from "../workspace/workspace-service";
import { IManagementService, type ManagementSheet } from "./management-service";

type SettingsPage = {
  description: string;
  icon: string;
  id: string;
  title: string;
};

const pages: readonly SettingsPage[] = [
  {
    id: "settings",
    title: "Common Settings",
    icon: "settings-gear",
    description: "Appearance and behavior",
  },
  {
    id: "workspaces",
    title: "Workspaces",
    icon: "remote-explorer",
    description: "Agent execution environments",
  },
  {
    id: "templates",
    title: "Templates",
    icon: "symbol-structure",
    description: "Immutable workspace sources",
  },
  {
    id: "credentials",
    title: "Credentials",
    icon: "key",
    description: "Secrets and source access",
  },
  {
    id: "models",
    title: "Models",
    icon: "sparkle",
    description: "Available language models",
  },
  {
    id: "provisioners",
    title: "Provisioners",
    icon: "server-environment",
    description: "Runtime capacity",
  },
];

@injectable()
export class ManagementPane extends Disposable implements IWorkbenchView {
  readonly id = "zaw.management";
  private readonly pane = createElement("section", {
    className: "management-backdrop",
    ariaLabel: "Settings",
  });
  private readonly window = createElement("div", {
    className: "management-surface",
  });
  private readonly collapsedModelProviders = new Set<string>();
  private rendering = new DisposableStore();
  private sheetRoot: HTMLElement | undefined;
  private sheetModal: IDisposable | undefined;

  constructor(
    @inject(ViewRoot) private readonly root: HTMLElement,
    @inject(IManagementService) private readonly management: IManagementService,
    @inject(IWorkspaceService) private readonly workspaces: IWorkspaceService,
    @inject(ICommandService) private readonly commands: ICommandService,
    @inject(IThemeService) private readonly theme: IThemeService,
    @inject(INotificationService)
    private readonly notifications: INotificationService,
    @inject(IOverlayService) private readonly overlay: IOverlayService,
  ) {
    super();
    this.root.classList.add("zaw-settings-window");
    this.root.setAttribute("aria-label", "Settings");
    this.pane.append(this.window);
    this.root.append(this.pane);
    queueMicrotask(() =>
      this._register(
        this.overlay.activateModal(this.root, () => this.management.close()),
      ),
    );
    this._register(this.management.onDidChange(() => this.render()));
    this._register(this.workspaces.onDidChange(() => this.render()));
    this._register(this.theme.onDidChange(() => this.render()));
    this.render();
    void Promise.all([
      this.management.reload(),
      this.management.reloadRuntime(),
      this.workspaces.reload(),
    ]).catch((error) => this.notifications.error(error));
  }

  private render(): void {
    this.rendering.dispose();
    this.rendering = new DisposableStore();
    this.destroySheetWindow();
    const toolbar = createElement("header", {
      className: "management-toolbar",
    });
    toolbar.dataset.overlayDrag = "true";
    const title = createElement("div", { className: "management-title" });
    title.append(createElement("strong", { textContent: "Settings" }));
    const toolbarActions = createElement("div", {
      className: "management-toolbar-actions",
    });
    toolbarActions.append(
      this.iconButton(
        "refresh",
        "Refresh settings",
        () =>
          void Promise.all([
            this.management.reload(),
            this.management.reloadRuntime(),
            this.workspaces.reload(),
          ]).catch((error) => this.notifications.error(error)),
      ),
      this.iconButton("close", "Close Settings", () => this.management.close()),
    );
    toolbar.append(title, toolbarActions);

    const navigation = createElement("nav", {
      ariaLabel: "Settings categories",
      className: "management-navigation",
    });
    for (const page of pages) {
      const selected = page.id === this.management.managementViewID;
      const item = createElement("button", {
        className: `management-navigation-item${selected ? " active" : ""}`,
      });
      item.type = "button";
      item.setAttribute("aria-current", selected ? "page" : "false");
      item.append(
        createElement("span", { className: `codicon codicon-${page.icon}` }),
        createElement("span", { textContent: page.title }),
      );
      item.addEventListener("click", () =>
        this.management.selectManagementView(page.id),
      );
      navigation.append(item);
    }

    const content = createElement("main", { className: "management-content" });
    this.renderPage(content);
    this.window.replaceChildren(toolbar, navigation, content);
    if (this.management.sheet) this.openSheetWindow(this.management.sheet);
  }

  private renderPage(content: HTMLElement): void {
    switch (this.management.managementViewID) {
      case "workspaces":
        this.renderWorkspaces(content);
        break;
      case "templates":
        this.renderTemplates(content);
        break;
      case "credentials":
        this.renderCredentials(content);
        break;
      case "models":
        this.renderModels(content);
        break;
      case "provisioners":
        this.renderProvisioners(content);
        break;
      default:
        this.renderCommonSettings(content);
    }
  }

  private pageHeader(
    title: string,
    description: string,
    action?: Node,
  ): HTMLElement {
    const header = createElement("header", {
      className: "management-content-header",
    });
    const copy = createElement("div");
    copy.append(
      createElement("h1", { textContent: title }),
      createElement("p", { textContent: description }),
    );
    header.append(copy);
    if (action) header.append(action);
    return header;
  }

  private renderCommonSettings(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Common Settings",
        "Configure the Agents workbench for this browser.",
      ),
    );
    const section = createElement("section", {
      className: "management-settings-group",
    });
    section.append(createElement("h2", { textContent: "Appearance" }));
    const row = this.settingRow(
      "Color Theme",
      "Controls the colors used by the complete Agents window.",
    );
    const selectRoot = createElement("div");
    const select = this.track(
      new SelectWidget(selectRoot, {
        ariaLabel: "Color theme",
        options: [
          { label: "System", value: "system" },
          { label: "Dark", value: "dark" },
          { label: "Light", value: "light" },
          { label: "High Contrast", value: "hc" },
        ],
        value: this.theme.current,
      }),
    );
    select.onDidSelect(
      ({ value }) =>
        void this.commands.executeCommand("zaw.theme.set", value as ColorTheme),
    );
    row.append(selectRoot);
    section.append(row);

    const behavior = createElement("section", {
      className: "management-settings-group",
    });
    behavior.append(createElement("h2", { textContent: "Agents Window" }));
    behavior.append(
      this.readonlySetting(
        "Settings Shortcut",
        "Open Settings from anywhere in the window.",
        "Ctrl+,",
      ),
      this.readonlySetting(
        "Layout Persistence",
        "Panel visibility, sash sizes, focus and selection are restored automatically.",
        "Enabled",
      ),
      this.readonlySetting(
        "Reduced Motion",
        "Animation follows the operating-system accessibility preference.",
        "System",
      ),
    );
    content.append(section, behavior);
  }

  private renderWorkspaces(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Workspaces",
        "Create and manage the execution environments used by agent sessions.",
        this.button(
          "Create",
          "add",
          () => this.management.openWorkspaceCreate(),
          true,
        ),
      ),
    );
    content.append(
      this.resourceList(
        this.workspaces.workspaces,
        "No workspaces have been created.",
        (workspace) => this.workspaceRow(workspace),
      ),
    );
  }

  private workspaceRow(workspace: Workspace): HTMLElement {
    const status =
      workspace.agentHostState || workspace.observedState || "offline";
    return this.resourceRow(
      workspace.name,
      `${status} · ${workspace.desiredState}`,
      [
        this.iconButton("output", `View build logs for ${workspace.name}`, () =>
          this.management.openBuildLogs(workspace.id),
        ),
        workspace.desiredState === "stopped"
          ? this.iconButton(
              "debug-start",
              `Start ${workspace.name}`,
              () =>
                void this.runWorkspaceAction(() =>
                  this.management.startWorkspace(workspace.id),
                ),
            )
          : this.iconButton("debug-stop", `Stop ${workspace.name}`, () =>
              this.management.requestWorkspaceStop(workspace.id),
            ),
        this.iconButton(
          "trash",
          `Delete ${workspace.name}`,
          () =>
            void this.runWorkspaceAction(() =>
              this.management.deleteWorkspace(workspace.id),
            ),
        ),
      ],
    );
  }

  private renderTemplates(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Templates",
        "Pinned Git repositories and archives used to create reproducible workspaces.",
        this.button(
          "Add Template",
          "add",
          () => this.management.addTemplate(),
          true,
        ),
      ),
    );
    content.append(
      this.resourceList(
        this.management.templates,
        "No templates are configured.",
        (template) =>
          this.resourceRow(
            template.name,
            template.description ||
              `${template.source.kind}: ${template.source.url}`,
            [
              this.iconButton("edit", `Edit ${template.name}`, () =>
                this.management.editTemplate(template.id),
              ),
              this.iconButton("trash", `Delete ${template.name}`, () =>
                this.management.requestDeleteTemplate(template.id),
              ),
            ],
          ),
      ),
    );
  }

  private renderCredentials(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Credentials",
        "Credential metadata is stored by the control plane; " +
          "secret values remain in protected local files.",
        this.button(
          "Add Credential",
          "add",
          () => this.management.addCredential(),
          true,
        ),
      ),
    );
    content.append(
      this.resourceList(
        this.management.credentials,
        "No credentials are configured.",
        (credential) =>
          this.resourceRow(
            credential.name,
            credential.kind.replaceAll("_", " "),
            [
              this.iconButton("edit", `Edit ${credential.name}`, () =>
                this.management.editCredential(credential.id),
              ),
              this.iconButton("trash", `Delete ${credential.name}`, () =>
                this.management.requestDeleteCredential(credential.id),
              ),
            ],
          ),
      ),
    );
  }

  private renderModels(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Models",
        "Language models available to new and active agent sessions.",
        this.button(
          "Add Provider",
          "add",
          () => this.management.addModelProvider(),
          true,
        ),
      ),
    );
    if (this.management.modelsState === "loading") {
      content.append(this.empty("Loading models…", "loading"));
      return;
    }
    if (this.management.modelsState === "error") {
      content.append(
        this.empty(
          this.management.modelsError || "Unable to load models",
          "error",
        ),
      );
      return;
    }
    if (!this.management.modelProviders.length) {
      content.append(this.empty("No model providers are configured."));
      return;
    }
    const tree = createElement("ul", {
      ariaLabel: "Model providers and models",
      className: "management-model-tree",
      role: "tree",
    });
    for (const provider of this.management.modelProviders) {
      const providerItem = createElement("li", { role: "none" });
      const providerRow = createElement("div", {
        className: "management-model-tree-row provider",
        role: "treeitem",
      });
      const collapsed = this.collapsedModelProviders.has(provider.id);
      providerRow.setAttribute("aria-expanded", String(!collapsed));
      providerRow.setAttribute("aria-level", "1");
      const toggle = this.iconButton(
        collapsed ? "chevron-right" : "chevron-down",
        `${collapsed ? "Expand" : "Collapse"} ${provider.name}`,
        () => {
          if (collapsed) this.collapsedModelProviders.delete(provider.id);
          else this.collapsedModelProviders.add(provider.id);
          this.render();
        },
      );
      const label = createElement("button", {
        className: "management-model-tree-label",
      });
      label.type = "button";
      label.append(
        createElement("span", {
          className: "management-model-tree-name",
          textContent: provider.name,
        }),
        createElement("span", {
          className: "management-model-tree-description",
          textContent: provider.kind,
        }),
      );
      label.addEventListener("click", () => toggle.click());
      const actions = createElement("div", {
        className: "management-row-actions",
      });
      actions.append(
        this.iconButton("add", `Add model to ${provider.name}`, () =>
          this.management.addModel(provider.id),
        ),
        this.iconButton("edit", `Edit ${provider.name}`, () =>
          this.management.editModelProvider(provider.id),
        ),
        this.iconButton(
          "trash",
          `Delete ${provider.name}`,
          () =>
            void this.runAction(() =>
              this.management.deleteModelProvider(provider.id),
            ),
        ),
      );
      providerRow.append(toggle, label, actions);
      providerItem.append(providerRow);
      if (!collapsed) {
        const models = this.management.models.filter(
          (model) => model.providerId === provider.id,
        );
        const group = createElement("ul", { role: "group" });
        for (const model of models) {
          const modelItem = createElement("li", { role: "none" });
          const modelRow = createElement("div", {
            className: "management-model-tree-row model",
            role: "treeitem",
          });
          modelRow.setAttribute("aria-level", "2");
          const modelLabel = createElement("div", {
            className: "management-model-tree-label",
          });
          modelLabel.append(
            createElement("span", {
              className: "management-model-tree-name",
              textContent: model.name,
            }),
            createElement("span", {
              className: "management-model-tree-description",
              textContent: [
                model.upstreamModel,
                model.capabilities.contextWindow
                  ? `${Math.round(model.capabilities.contextWindow / 1000)}k`
                  : "",
                model.capabilities.imageInput ? "vision" : "",
              ]
                .filter(Boolean)
                .join(" · "),
            }),
          );
          const modelActions = createElement("div", {
            className: "management-row-actions",
          });
          modelActions.append(
            this.iconButton("edit", `Edit ${model.name}`, () =>
              this.management.editModel(model.id),
            ),
            this.iconButton(
              "trash",
              `Delete ${model.name}`,
              () =>
                void this.runAction(() =>
                  this.management.deleteModel(model.id),
                ),
            ),
          );
          modelRow.append(
            createElement("span", {
              className: "management-model-tree-indent",
            }),
            modelLabel,
            modelActions,
          );
          modelItem.append(modelRow);
          group.append(modelItem);
        }
        providerItem.append(group);
      }
      tree.append(providerItem);
    }
    content.append(tree);
  }

  private renderProvisioners(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Provisioners",
        "Connected infrastructure provisioners and readiness.",
      ),
    );
    content.append(
      this.resourceList(
        this.management.provisioners,
        "No provisioners are connected.",
        (item) =>
          this.resourceRow(
            item.name,
            `${item.addr} · ${item.ready ? "ready" : "not ready"}`,
          ),
      ),
    );
  }

  private renderJobs(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Provisioner Jobs",
        "Current and recent infrastructure jobs.",
      ),
    );
    content.append(
      this.resourceList(this.management.jobs, "No provisioner jobs.", (item) =>
        this.resourceRow(
          item.id,
          `${item.status} · workspace ${item.workspaceID}`,
        ),
      ),
    );
  }

  private renderBuilds(content: HTMLElement): void {
    content.append(
      this.pageHeader(
        "Workspace Builds",
        "Build history for workspace lifecycle operations.",
      ),
    );
    content.append(
      this.resourceList(
        this.management.builds,
        "No workspace builds.",
        (item) =>
          this.resourceRow(
            item.id,
            `${item.status} · workspace ${item.workspaceID}`,
          ),
      ),
    );
  }

  private renderSheet(sheet: ManagementSheet): HTMLElement {
    const dialog = createElement("section", {
      ariaLabel: this.sheetTitle(sheet),
      className: "management-sheet",
      role: "dialog",
    });
    dialog.setAttribute("aria-modal", "true");
    const header = createElement("header");
    header.append(
      createElement("strong", { textContent: this.sheetTitle(sheet) }),
      this.iconButton("close", "Close dialog", () =>
        this.management.closeSheet(),
      ),
    );
    const body = createElement("div", {
      className: "management-sheet-content",
    });
    switch (sheet) {
      case "workspace-create":
        this.workspaceForm(body);
        break;
      case "build-logs":
        this.buildLogs(body);
        break;
      case "template-source":
        this.templateSource(body);
        break;
      case "template":
        this.templateForm(body);
        break;
      case "credential":
        this.credentialForm(body);
        break;
      case "model-provider":
        this.modelProviderForm(body);
        break;
      case "model":
        this.modelForm(body);
        break;
      case "confirm-template-delete":
        this.confirm(
          body,
          "Delete this template? Existing workspaces keep their pinned source snapshot.",
          "Delete Template",
          () => void this.runAction(() => this.management.deleteTemplate()),
        );
        break;
      case "confirm-credential-delete":
        this.confirm(
          body,
          "Delete this credential? Credentials referenced by a template cannot be deleted.",
          "Delete Credential",
          () =>
            void this.runAction(() =>
              this.management.deleteCredential(
                this.management.pendingCredentialDeleteID,
              ),
            ),
        );
        break;
      case "confirm-workspace-stop":
        this.confirm(
          body,
          "Stop this workspace? Its resources are retained and can be started again.",
          "Stop Workspace",
          () =>
            void this.runWorkspaceAction(() =>
              this.management.stopWorkspace(this.management.pendingWorkspaceID),
            ),
        );
        break;
    }
    dialog.append(header, body);
    return dialog;
  }

  private openSheetWindow(sheet: ManagementSheet): void {
    const root = createElement("div", {
      className: "management-sheet-window",
    });
    const width = sheet === "build-logs" ? 760 : 560;
    const height = sheet === "build-logs" ? 560 : 620;
    const actualWidth = Math.min(width, window.innerWidth - 48);
    const actualHeight = Math.min(height, window.innerHeight - 48);
    root.style.left = `${Math.max(0, (window.innerWidth - actualWidth) / 2)}px`;
    root.style.top = `${Math.max(0, (window.innerHeight - actualHeight) / 2)}px`;
    root.style.width = `${actualWidth}px`;
    root.style.height = `${actualHeight}px`;
    root.append(this.renderSheet(sheet));
    const host =
      this.root.closest(".zaw-workbench") ??
      this.root.parentElement ??
      this.root;
    host.append(root);
    this.sheetRoot = root;
    this.sheetModal = this.overlay.activateModal(root, () =>
      this.management.closeSheet(),
    );
  }

  private destroySheetWindow(): void {
    this.sheetModal?.dispose();
    this.sheetModal = undefined;
    this.sheetRoot?.remove();
    this.sheetRoot = undefined;
  }

  private workspaceForm(body: HTMLElement): void {
    if (!this.management.templates.length) {
      body.append(
        this.empty("Create a workspace template before creating a workspace."),
        this.button(
          "Create Template",
          "add",
          () => this.management.addTemplate(),
          true,
        ),
      );
      return;
    }
    const form = this.form();
    const name = this.input(form, "Name", "workspace-name", {
      placeholder: "My workspace",
      required: true,
    });
    const template = this.select(
      form,
      "Template",
      "workspace-template",
      this.management.templates.map((item) => ({
        label: item.name,
        value: item.id,
      })),
      this.management.templates[0]?.id ?? "",
    );
    this.formFooter(form, "Create Workspace", async () => {
      if (!name.value.trim() || !template.value) return;
      const created = await this.workspaces.create({
        name: name.value.trim(),
        parameters: {},
        templateId: template.value,
      });
      this.management.closeSheet();
      this.notifications.info(
        `Workspace created; build ${created.buildId} is queued.`,
      );
    });
    body.append(form);
  }

  private buildLogs(body: HTMLElement): void {
    const workspace = this.workspaces.workspaces.find(
      (item) => item.id === this.management.pendingWorkspaceID,
    );
    const output = createElement("div", {
      ariaLabel: "Workspace build logs",
      className: "management-build-logs",
    });
    body.append(
      createElement("p", {
        className: "management-sheet-description",
        textContent: workspace?.currentBuildId
          ? `${workspace.name} · build ${workspace.currentBuildId}`
          : `${workspace?.name ?? "Workspace"} has no current build.`,
      }),
      output,
    );
    const style = getComputedStyle(this.pane);
    const terminal = this.track(
      new Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily:
          "var(--zaw-monospace-font, 'SFMono-Regular', Consolas, monospace)",
        fontSize: 12,
        lineHeight: 1.35,
        scrollback: 5000,
        theme: {
          background:
            style.getPropertyValue("--zaw-terminal-background").trim() ||
            "#000000",
          foreground:
            style.getPropertyValue("--zaw-terminal-foreground").trim() ||
            "#cccccc",
        },
      }),
    );
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(output);
    let rendered = "";
    let loading = false;
    let disposed = false;
    const write = (value: string) => {
      if (value === rendered) return;
      if (value.startsWith(rendered))
        terminal.write(value.slice(rendered.length));
      else {
        terminal.reset();
        terminal.write(value);
      }
      rendered = value;
      terminal.scrollToBottom();
    };
    const refresh = async () => {
      if (loading || disposed) return;
      loading = true;
      try {
        const logs = await this.workspaces.loadBuildLogs(
          this.management.pendingWorkspaceID,
        );
        if (!disposed) write(logs || "No build output is available.\n");
      } catch {
        if (!disposed && !rendered) write("Unable to load build logs.\n");
      } finally {
        loading = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), 2_000);
    const observer = new ResizeObserver(() => {
      if (output.clientWidth > 0) fit.fit();
    });
    observer.observe(output);
    this.rendering.add({
      dispose: () => {
        disposed = true;
        window.clearInterval(interval);
        observer.disconnect();
      },
    });
    queueMicrotask(() => {
      if (!disposed && output.clientWidth > 0) fit.fit();
    });
    void refresh();
  }

  private templateSource(body: HTMLElement): void {
    body.append(
      createElement("p", {
        className: "management-sheet-description",
        textContent:
          "Choose an immutable source type. Git refs and archive checksums are pinned when saved.",
      }),
    );
    const choices = createElement("div", {
      className: "management-source-choices",
    });
    choices.append(
      this.sourceChoice(
        "git-merge",
        "Git Repository",
        "Pin a branch, tag or commit from a Git repository.",
        () => this.management.chooseTemplateKind("git"),
      ),
      this.sourceChoice(
        "file-zip",
        "Tar Archive",
        "Download and verify an immutable archive.",
        () => this.management.chooseTemplateKind("tar"),
      ),
    );
    body.append(choices);
  }

  private templateForm(body: HTMLElement): void {
    const editing = this.management.editingTemplate;
    const source = editing?.source;
    const form = this.form();
    const name = this.input(form, "Name", "template-name", {
      value: editing?.name ?? "",
      required: true,
    });
    const description = this.input(
      form,
      "Description",
      "template-description",
      { value: editing?.description ?? "" },
    );
    const url = this.input(
      form,
      this.management.templateKind === "git" ? "Repository URL" : "Archive URL",
      "template-url",
      { type: "url", value: source?.url ?? "", required: true },
    );
    const ref =
      this.management.templateKind === "git"
        ? this.input(form, "Ref", "template-ref", {
            value: source?.ref ?? "main",
          })
        : this.input(form, "SHA-256", "template-sha256", {
            value: source?.sha256 ?? "",
          });
    const credential = this.select(
      form,
      "System Credential",
      "template-credential",
      [
        { label: "None", value: "" },
        ...this.management.credentials.map((item) => ({
          label: item.name,
          value: item.id,
        })),
      ],
      source?.credentialId ?? "",
    );
    this.formFooter(
      form,
      editing ? "Save Changes" : "Save Template",
      async () => {
        if (!name.value.trim() || !url.value.trim()) return;
        const nextSource: Record<string, unknown> = {
          kind: this.management.templateKind,
          url: url.value.trim(),
        };
        if (this.management.templateKind === "git")
          nextSource.ref = ref.value.trim() || "main";
        else if (ref.value.trim()) nextSource.sha256 = ref.value.trim();
        if (credential.value) nextSource.credentialId = credential.value;
        await this.management.saveTemplate(
          name.value.trim(),
          description.value.trim(),
          nextSource,
        );
        this.notifications.info("Template saved.");
      },
    );
    body.append(form);
  }

  private credentialForm(body: HTMLElement): void {
    const editing = this.management.editingCredential;
    const form = this.form();
    const name = this.input(form, "Name", "credential-name", {
      value: editing?.name ?? "",
      required: true,
    });
    const kind = this.select(
      form,
      "Type",
      "credential-kind",
      [
        { label: "Token", value: "token" },
        { label: "Username and Password", value: "username_password" },
        { label: "SSH Key", value: "ssh_key" },
      ],
      this.management.credentialKind,
    );
    const username = this.input(
      form,
      "Username (when required)",
      "credential-username",
      {
        value: editing?.metadata.username ?? "",
      },
    );
    const secret = this.input(form, "Secret value", "credential-secret", {
      type: "password",
      placeholder: editing
        ? "Leave blank to keep the current secret"
        : "Token, password, or private key",
    });
    this.formFooter(
      form,
      editing ? "Save Changes" : "Save Credential",
      async () => {
        if (!name.value.trim()) return;
        const selectedKind = kind.value as Credential["kind"];
        const metadata: Record<string, string> = {};
        if (username.value) metadata.username = username.value;
        const secretValues: Record<string, string> = {};
        if (secret.value)
          secretValues[
            selectedKind === "token"
              ? "token"
              : selectedKind === "ssh_key"
                ? "privateKey"
                : "password"
          ] = secret.value;
        await this.management.saveCredential(
          name.value.trim(),
          selectedKind,
          metadata,
          secretValues,
        );
        this.notifications.info("Credential saved.");
      },
    );
    body.append(form);
  }

  private modelProviderForm(body: HTMLElement): void {
    const editing = this.management.editingModelProvider;
    const form = this.form();
    const id = this.input(form, "Provider ID", "model-provider-id", {
      placeholder: "deepseek",
      value: editing?.id ?? "",
      required: true,
    });
    id.disabled = Boolean(editing);
    id.maxLength = 26;
    id.pattern = "[a-z0-9][a-z0-9._-]*";
    const name = this.input(form, "Provider name", "model-provider-name", {
      value: editing?.name ?? "",
      required: true,
    });
    const kind = this.select(
      form,
      "Protocol",
      "model-provider-kind",
      [
        { label: "OpenAI", value: "openai" },
        { label: "Anthropic", value: "anthropic" },
        { label: "DeepSeek", value: "deepseek" },
      ],
      editing?.kind ?? "openai",
    );
    const apiBase = this.input(form, "API Base", "model-provider-api-base", {
      type: "url",
      value: editing?.apiBase ?? "",
      required: true,
    });
    const apiKey = this.input(form, "API key", "model-provider-api-key", {
      type: "password",
      placeholder: editing ? "Leave blank to keep the current key" : "Required",
      required: !editing,
    });
    this.formFooter(
      form,
      editing ? "Save Provider" : "Add Provider",
      async () => {
        if (
          !id.value.trim() ||
          !name.value.trim() ||
          !apiBase.value.trim() ||
          (!editing && !apiKey.value)
        )
          return;
        await this.management.saveModelProvider(
          id.value.trim(),
          name.value.trim(),
          kind.value as "anthropic" | "deepseek" | "openai",
          apiBase.value.trim(),
          apiKey.value,
        );
        this.notifications.info("Model provider saved.");
      },
    );
    body.append(form);
  }

  private modelForm(body: HTMLElement): void {
    const editing = this.management.editingModel;
    const form = this.form();
    const provider = this.select(
      form,
      "Provider",
      "model-provider",
      this.management.modelProviders.map((item) => ({
        label: item.name,
        value: item.id,
      })),
      editing?.providerId || this.management.modelProviderID,
    );
    provider.disabled = Boolean(editing);
    const name = this.input(form, "Model name", "model-name", {
      value: editing?.name ?? "",
      required: true,
    });
    const upstream = this.input(form, "Upstream model", "upstream-model", {
      value: editing?.upstreamModel ?? "",
      required: true,
    });
    const contextWindow = this.input(
      form,
      "Context window (tokens)",
      "model-context-window",
      {
        type: "number",
        value: String(editing?.capabilities.contextWindow || 128000),
        required: true,
      },
    );
    contextWindow.min = "1";
    contextWindow.step = "1000";
    const capabilities = createElement("fieldset", {
      className: "management-model-capabilities",
    });
    capabilities.append(
      createElement("legend", { textContent: "Capabilities" }),
    );
    const vision = this.checkbox(
      capabilities,
      "Vision input",
      "model-vision",
      editing?.capabilities.imageInput ?? false,
    );
    const reasoning = this.checkbox(
      capabilities,
      "Reasoning",
      "model-reasoning",
      editing?.capabilities.reasoning ?? false,
    );
    const tools = this.checkbox(
      capabilities,
      "Tool use",
      "model-tools",
      editing?.capabilities.tools ?? true,
    );
    const structuredOutput = this.checkbox(
      capabilities,
      "Structured output",
      "model-structured-output",
      editing?.capabilities.structuredOutput ?? true,
    );
    const streaming = this.checkbox(
      capabilities,
      "Streaming",
      "model-streaming",
      editing?.capabilities.streaming ?? true,
    );
    form.append(capabilities);
    const effortGroup = createElement("fieldset", {
      className: "management-reasoning-efforts",
    });
    effortGroup.append(
      createElement("legend", { textContent: "Supported reasoning efforts" }),
    );
    const effortList = createElement("div", {
      className: "management-reasoning-effort-list",
    });
    const effortInputs: HTMLInputElement[] = [];
    let effortSequence = 0;
    const addEffort = (value = "") => {
      const row = createElement("div", {
        className: "management-reasoning-effort-row",
      });
      const inputHost = createElement("div");
      this.track(
        new InputWidget(inputHost, {
          ariaLabel: "Reasoning effort",
          name: `model-reasoning-effort-${effortSequence++}`,
          placeholder: "For example: high",
          value,
        }),
      );
      const input = inputHost.querySelector("input")!;
      effortInputs.push(input);
      row.append(
        inputHost,
        this.iconButton("remove", `Remove reasoning effort ${value}`, () => {
          const index = effortInputs.indexOf(input);
          if (index >= 0) effortInputs.splice(index, 1);
          row.remove();
          this.management.setDirty(true);
        }),
      );
      effortList.append(row);
      if (!value) queueMicrotask(() => input.focus());
    };
    for (const effort of editing?.capabilities.reasoningEfforts ?? [])
      addEffort(effort);
    effortGroup.append(
      effortList,
      this.button("Add effort", "add", () => {
        addEffort();
        this.management.setDirty(true);
      }),
    );
    form.append(effortGroup);
    this.formFooter(form, editing ? "Save Model" : "Add Model", async () => {
      if (!provider.value || !name.value.trim() || !upstream.value.trim())
        return;
      const configuredEfforts = reasoning.checked
        ? [...new Set(effortInputs.map((input) => input.value.trim()))].filter(
            Boolean,
          )
        : [];
      await this.management.saveModel(
        provider.value,
        name.value.trim(),
        upstream.value.trim(),
        false,
        {
          textInput: true,
          contextWindow: Number.parseInt(contextWindow.value, 10),
          imageInput: vision.checked,
          reasoning: reasoning.checked,
          tools: tools.checked,
          structuredOutput: structuredOutput.checked,
          streaming: streaming.checked,
          reasoningEfforts: configuredEfforts,
        },
      );
      this.notifications.info("Model saved.");
    });
    body.append(form);
  }

  private confirm(
    body: HTMLElement,
    message: string,
    primary: string,
    action: () => void,
    secondary = "Cancel",
    secondaryAction = () => this.management.closeSheet(),
  ): void {
    body.append(
      createElement("p", {
        className: "management-sheet-description",
        textContent: message,
      }),
    );
    const actions = createElement("footer", {
      className: "management-form-actions",
    });
    actions.append(
      this.button(secondary, undefined, secondaryAction),
      this.button(primary, undefined, action, true, "danger-action"),
    );
    body.append(actions);
  }

  private form(): HTMLFormElement {
    const form = createElement("form", { className: "management-form" });
    form.addEventListener("submit", (event) => event.preventDefault());
    form.addEventListener("input", () => this.management.setDirty(true));
    return form;
  }

  private input(
    form: HTMLElement,
    text: string,
    name: string,
    options: {
      placeholder?: string;
      required?: boolean;
      type?: "number" | "password" | "text" | "url";
      value?: string;
    },
  ): HTMLInputElement {
    const label = createElement("label");
    label.append(createElement("span", { textContent: text }));
    const host = createElement("div");
    this.track(new InputWidget(host, { ariaLabel: text, name, ...options }));
    const input = host.querySelector("input")!;
    label.append(host);
    form.append(label);
    return input;
  }

  private checkbox(
    parent: HTMLElement,
    label: string,
    name: string,
    checked: boolean,
  ): HTMLInputElement {
    const host = createElement("div");
    const checkbox = this.track(
      new CheckboxWidget(host, { checked, label, name }),
    );
    checkbox.onDidChange(() => this.management.setDirty(true));
    parent.append(host);
    return host.querySelector("input")!;
  }

  private select(
    form: HTMLElement,
    text: string,
    name: string,
    options: { label: string; value: string }[],
    value: string,
  ): HTMLInputElement {
    const field = createElement("div", { className: "management-form-field" });
    field.append(createElement("span", { textContent: text }));
    const host = createElement("div");
    const select = this.track(
      new SelectWidget(host, { ariaLabel: text, name, options, value }),
    );
    select.onDidSelect(() => this.management.setDirty(true));
    field.append(host);
    form.append(field);
    return host.querySelector("input")!;
  }

  private formFooter(
    form: HTMLElement,
    primary: string,
    action: () => Promise<void>,
  ): void {
    const footer = createElement("footer", {
      className: "management-form-actions",
    });
    footer.append(
      this.button("Cancel", undefined, () => this.management.closeSheet()),
      this.button(primary, undefined, () => void this.runAction(action), true),
    );
    form.append(footer);
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.notifications.error(error);
    }
  }

  private async runWorkspaceAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      await this.workspaces.reload();
    } catch (error) {
      this.notifications.error(error);
    }
  }

  private resourceList<T>(
    items: readonly T[],
    empty: string,
    render: (item: T) => HTMLElement,
  ): HTMLElement {
    const list = createElement("div", {
      className: "management-resource-list",
      role: "list",
    });
    if (!items.length) list.append(this.empty(empty));
    else list.append(...items.map(render));
    return list;
  }

  private resourceRow(
    title: string,
    description: string,
    actions: Node[] = [],
  ): HTMLElement {
    const row = createElement("article", {
      className: "management-resource-row",
      role: "listitem",
    });
    const copy = createElement("div");
    copy.append(
      createElement("strong", { textContent: title }),
      createElement("small", { textContent: description }),
    );
    row.append(copy);
    if (actions.length) {
      const host = createElement("div", {
        className: "management-row-actions",
      });
      host.append(...actions);
      row.append(host);
    }
    return row;
  }

  private settingRow(title: string, description: string): HTMLElement {
    const row = createElement("div", { className: "management-setting-row" });
    const copy = createElement("div");
    copy.append(
      createElement("strong", { textContent: title }),
      createElement("small", { textContent: description }),
    );
    row.append(copy);
    return row;
  }

  private readonlySetting(
    title: string,
    description: string,
    value: string,
  ): HTMLElement {
    const row = this.settingRow(title, description);
    row.append(createElement("code", { textContent: value }));
    return row;
  }

  private empty(message: string, state = "empty"): HTMLElement {
    const empty = createElement("p", {
      className: "management-empty",
      textContent: message,
    });
    empty.dataset.state = state;
    return empty;
  }

  private sourceChoice(
    icon: string,
    title: string,
    description: string,
    action: () => void,
  ): HTMLElement {
    const button = createElement("button", {
      className: "management-source-choice",
    });
    button.type = "button";
    button.append(
      createElement("span", { className: `codicon codicon-${icon}` }),
      createElement("strong", { textContent: title }),
      createElement("small", { textContent: description }),
    );
    button.addEventListener("click", action);
    return button;
  }

  private iconButton(
    icon: string,
    label: string,
    action: () => void,
  ): HTMLElement {
    const host = createElement("span");
    const button = this.track(
      new IconActionButton(host, { ariaLabel: label, icon }),
    );
    button.onDidClick(action);
    return host.firstElementChild as HTMLElement;
  }

  private button(
    text: string,
    icon: string | undefined,
    action: () => void,
    primary = false,
    className?: string,
  ): HTMLElement {
    const host = createElement("span");
    const ctor = primary ? PrimaryButtonWidget : ButtonWidget;
    const button = this.track(
      new ctor(host, { className, icon, label: text, text }),
    );
    button.onDidClick(action);
    return host.firstElementChild as HTMLElement;
  }

  private track<T extends IDisposable>(value: T): T {
    this.rendering.add(value);
    return value;
  }

  override dispose(): void {
    this.destroySheetWindow();
    this.rendering.dispose();
    super.dispose();
  }

  private sheetTitle(sheet: ManagementSheet): string {
    switch (sheet) {
      case "workspace-create":
        return "Create Workspace";
      case "build-logs":
        return "Build Logs";
      case "template-source":
        return "Add Template";
      case "template":
        return this.management.editingTemplate ? "Edit Template" : "Template";
      case "credential":
        return this.management.editingCredential
          ? "Edit Credential"
          : "Add Credential";
      case "model-provider":
        return this.management.editingModelProvider
          ? "Edit Model Provider"
          : "Add Model Provider";
      case "model":
        return this.management.editingModel ? "Edit Model" : "Add Model";
      case "confirm-template-delete":
        return "Delete Template";
      case "confirm-credential-delete":
        return "Delete Credential";
      case "confirm-workspace-stop":
        return "Stop Workspace";
      default:
        return "Settings";
    }
  }
}
