# Workbench 架构改造路线图

> 本路线图定义 Workbench 从当前中央应用控制器迁移为 VS Code 风格可扩展
> 工作台的最终方案。目标不是缩短单个文件，而是建立稳定的 Part、生命周期
> Contribution、领域 Service、Command、Context Key、View Registry 和依赖注入
> 边界。R12 完成前，不得将“已经有统一 View Registry”视为架构改造完成。

## 状态约定

- `[ ]` 未开始。
- `[-]` 进行中。
- `[x]` 已完成并通过验收。
- 每个阶段必须同时完成实现、删除项、自动化测试和架构检查。
- 不保留旧路径作为 fallback；阶段完成后必须删除被替代的接口和实现。

## 当前基线

截至 2026-07-27（R0-R12 架构迁移完成；Agents Window UI 对齐尚未完成）：

- [x] Widget 使用构造函数接收 `HTMLElement`，通过 DOM API 创建节点。
- [x] Widget 使用 `Event<T>`、`Emitter<T>` 和 `onDidXxx` 暴露事件。
- [x] View Container 和 View Descriptor 已有统一注册表，支持 DI ctor。
- [x] 内建顶层 View 已通过 contribution 注册。
- [x] Inversify token 位于各自接口或类模块，不再集中维护 types map。
- [x] 服务使用 `@injectable()` 和显式 `@inject()` 构造注入。
- [x] `Workbench` 已注入 4 个领域 Service（Management/SessionCatalog/Terminal/WorkspaceResource）。
- [x] `viewContext()` 中的 Management/Terminal/Catalog 状态从 Service 读取。
- [x] `handleViewAction()` 中 24 个 action case 已委托给领域 Service。
- [x] `managementActionHandlers` 已删除（替换为 Service 方法调用）。
- [x] 18 个死方法已删除（终端/文件/变更/管理 CRUD）。
- [x] 19 个死字段已删除（与 Service 重复的状态声明）。
- [x] `IManagementProvider` 和 `ISessionCatalogProvider` 不再注入 Workbench。
- [x] `applySessionCatalog`、`refreshSessionCatalog`、`reloadRuntimeMetadata` 方法已删除。
- [x] Session Catalog polling 由 `SessionCatalogContribution` 管理。
- [x] `WorkbenchViewContext`、`WorkbenchViewAction` 和中央 dispatcher 已删除。
- [x] 状态变化由领域 Service 和长期运行的 View Host 局部处理。
- [x] 内建 View 使用 DI constructor descriptor，不使用闭包 factory。

R0-R12 只证明了工作台的依赖方向、生命周期和局部更新边界已经迁移完成，
不代表视觉与交互已经达到 VS Code Agents Window 的完成标准。UI 对齐继续按
R13-R20 推进；在 R20 通过前，不得将当前界面称为“VS Code Agents Window 复刻完成”。

最终规模：

- `bootstrap/workbench.ts`: **1479 行**（起始 1861，**-382 行，-21%**）
- `Workbench` @inject 参数: **20**（起始 16，-2 Provider +6 Service/Lifecycle/Layout）
- 删除的 Workbench 字段: **19 个**（builds/catalogTimer/credentials/credentialKind/dirtySheet/editingCredential/editingTemplate/jobs/managementHistory/managementQuery/managementScope/managementViewID/models/pendingCredentialDeleteID/pendingTemplateDeleteID/provisioners/templateKind/templates/terminalCollapsed）
- 删除的 Workbench 方法: **21 个**（18 死方法 + applySessionCatalog + refreshSessionCatalog + reloadRuntimeMetadata）
- `WorkbenchViewContext`: 58 字段（不变，数据源已从 Workbench 字段迁移到 Service）
- `WorkbenchViewAction`: 60 variant（不变，24 个 case 已委托给 Service）

## 最终架构

```text
BrowserMain
└─ Workbench
   ├─ LifecycleService
   ├─ WorkbenchLayoutService
   ├─ WorkbenchContributionsRegistry
   ├─ ViewDescriptorService
   └─ stable Parts
      ├─ TitlebarPart
      ├─ SidebarPart
      ├─ PrimaryPart
      ├─ AuxiliaryBarPart
      ├─ PanelPart
      └─ OverlayPart

Feature Contribution
├─ registerSingleton(domain service)
├─ registerWorkbenchContribution(lifecycle phase)
├─ registerViewContainer / registerViews
├─ registerCommand / registerAction
└─ registerContextKey

Feature View
├─ inject feature service
├─ subscribe onDidChange
├─ update owned DOM locally
└─ execute commands or call narrow service methods
```

最终约束：

- `Workbench` 只负责 startup、restore、shutdown、全局错误处理和 Part 布局。
- Workbench 不 import Session、Terminal、Changes、Files、Management 具体实现。
- Workbench 不持有任何领域列表、编辑表单、AHP 投影或 HTTP endpoint。
- Part 是稳定 DOM 和布局单元；状态变化不能替换整个 Workbench root。
- View 通过 descriptor 注册，由 DI 创建，并只注入本功能所需 Service。
- Service 是状态和行为的唯一所有者，并通过 `onDidXxx` 发布变化。
- Command 是行为入口；菜单、快捷键和 View 都调用同一个 command。
- Context Key 负责 action/菜单/view 的 enablement 和 visibility。
- Provider 只实现 typed port；View 和 Workbench 不知道 URL、JSON 或 AHP frame。
- Contribution 负责功能接线，不保存长期领域状态。
- 新增功能不得要求修改 `Workbench`、全局 context 或中央 dispatcher。

## 目标目录

```text
packages/workbench/src/
├─ bootstrap/
│  ├─ browser-main.ts
│  ├─ container.ts
│  └─ workbench.ts
├─ platform/
│  ├─ commands/
│  ├─ context-key/
│  ├─ lifecycle/
│  └─ registry/
├─ workbench/
│  ├─ contributions/
│  ├─ layout/
│  ├─ parts/
│  └─ views/
├─ contrib/
│  ├─ sessions/
│  ├─ terminal/
│  ├─ changes/
│  ├─ files/
│  ├─ management/
│  └─ notifications/
├─ providers/
└─ widgets/
```

目录表达所有权，不强制一次性搬动全部文件。文件移动必须伴随依赖方向检查，
不能只改变路径。

## 推进规则

1. 按 R0–R12 顺序推进；后续阶段不能依赖尚未建立的临时全局接口。
2. 每个 Service 先定义接口、事件、状态所有权和测试，再迁移调用方。
3. 每迁移一个行为，立即删除 `Workbench` 中对应字段、方法和 action variant。
4. 不创建第二套全局 store、event bus 或 service locator。
5. 不把 `WorkbenchViewContext` 拆成多个同样由 Workbench 组装的大 context。
6. 不允许 View 直接使用 `fetch`、WebSocket、AHP client 或 `Container.get()`。
7. 不允许 Contribution 长期持有可变领域状态；状态属于 Service。
8. 不允许 Command handler 操作 DOM；Command 只调用 Service。
9. 不允许 Service import View、Widget、Part 或具体 DOM 类型，布局服务除外。
10. 每阶段执行 typecheck、单元测试、格式检查和对应交互验证。

## 实施前置：先研究 VS Code

每个阶段开始编码前，实施者必须先阅读该阶段“VS Code 必读”中列出的源码。
这里的“参考”不是复制类名或目录，而是回答以下问题后，再决定 Zaw 的接口：

1. VS Code 中哪个 registry 保存静态 descriptor，哪个 service 保存运行时状态？
2. 对象由谁实例化、何时实例化、由谁 dispose？
3. 状态的唯一 owner 是谁，变化通过什么 `onDidXxx` 事件传播？
4. Command、Context Key、Menu、View Descriptor 如何关联，但不彼此持有？
5. Workbench 本身做了什么，又刻意没有做什么？

### 强制研究记录

每个阶段的第一个提交或阶段记录必须包含一份简短研究结论：

```text
VS Code 基准：<commit SHA 或阅读日期>
已读文件：<permalink 列表>
采用的机制：<机制及原因>
未采用的机制：<机制及 Zaw 不需要它的原因>
Zaw 对应接口：<目标文件和 symbol>
生命周期：<create / activate / dispose owner>
验证方式：<test name 或 command>
```

要求：

- [x] 开始阶段前，将 `main` 链接固定为当日 commit permalink，避免后续源码漂移。
- [x] 至少阅读接口/registry、运行时 service 和一个真实 feature contribution，不能只读一个文件。
- [x] 在代码评审中逐项回答上述五个问题。
- [x] 若设计偏离 VS Code，记录 Zaw 的约束和偏离理由，不以“更简单”为唯一理由。
- [x] 禁止逐行移植 VS Code；只借鉴职责、生命周期、依赖方向和注册模式。

### VS Code 源码索引

以下链接指向 VS Code `main`，实施时必须按上面的要求记录 commit SHA：

| 主题                   | 必读源码                                                                                                                                                                                                                                                                                                                                                              | 重点确认                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Workbench 边界         | [`workbench.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/workbench.ts)                                                                                                                                                                                                                                                                 | startup、稳定 Part 创建、restore、shutdown，及 Workbench 不承载 feature 状态 |
| Layout 与 Part         | [`layout.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts)、[`part.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/part.ts)、[`layoutService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/layout/browser/layoutService.ts)                                           | Part identity、尺寸、visibility、layout service contract                     |
| 生命周期               | [`lifecycle.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/lifecycle/common/lifecycle.ts)                                                                                                                                                                                                                                               | phase、`when()`、shutdown 事件                                               |
| Workbench Contribution | [`contributions.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/contributions.ts)                                                                                                                                                                                                                                                          | 分阶段和 lazy 实例化、异常隔离、timing、disposal                             |
| Registry               | [`platform.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/registry/common/platform.ts)                                                                                                                                                                                                                                                            | 静态 descriptor registry 的边界                                              |
| DI 与 Descriptor       | [`instantiation.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/instantiation/common/instantiation.ts)、[`descriptors.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/instantiation/common/descriptors.ts)、[`extensions.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/instantiation/common/extensions.ts) | service identifier、constructor descriptor、delayed/eager singleton          |
| Command                | [`commands.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/commands/common/commands.ts)                                                                                                                                                                                                                                                            | registry 与 execution service 分离、参数约束                                 |
| Action 与 Menu         | [`actions.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/actions/common/actions.ts)                                                                                                                                                                                                                                                               | 一个 action descriptor 如何连接 command、menu、keybinding 和 precondition    |
| Context Key            | [`contextkey.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/contextkey/common/contextkey.ts)                                                                                                                                                                                                                                                      | key、表达式、scoped context、buffered updates                                |
| View Registry          | [`views.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/views.ts)                                                                                                                                                                                                                                                                          | View Container/View descriptor、重复 ID、注册和注销事件                      |
| View Runtime           | [`viewDescriptorService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/browser/viewDescriptorService.ts)、[`viewsService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/browser/viewsService.ts)                                                                                              | descriptor model、Context Key、动态增删、创建和 focus                        |
| View DOM               | [`viewPane.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPane.ts)、[`viewPaneContainer.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPaneContainer.ts)                                                                                                                    | 长期 View 实例、局部 DOM、visibility 与 disposal                             |
| Feature Contribution   | [`explorerViewlet.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/explorerViewlet.ts)、[`files.contribution.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/files.contribution.ts)                                                                                                | Files 如何贡献 container、views、commands、welcome content                   |
| Terminal Feature       | [`terminal.contribution.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminal.contribution.ts)、[`terminalService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalService.ts)                                                                                    | Terminal contribution 与长期运行 service 的职责分离                          |

阅读顺序固定为：接口和 registry → runtime service → feature contribution →
Workbench 调用点。不要从具体 View 的 DOM 细节反推整个框架。

## 关键接口参考实现

以下代码是 Zaw 的目标形状，不是可直接提交的完整实现。实际命名、已有
`Event<T>` API 和 Inversify binding 必须与仓库保持一致。

### 生命周期 Contribution

目标文件：`platform/lifecycle/lifecycle.ts`、
`workbench/contributions/workbench-contributions.ts`。

```ts
export enum LifecyclePhase {
  Starting = 1,
  Ready = 2,
  Restored = 3,
  Eventually = 4,
}

export interface IWorkbenchContribution {
  dispose?(): void;
}

export interface WorkbenchContributionDescriptor {
  readonly id: string;
  readonly ctor: Newable<IWorkbenchContribution>;
  readonly phase: LifecyclePhase;
}

export class WorkbenchContributionsRegistry {
  register(descriptor: WorkbenchContributionDescriptor): IDisposable;
  start(container: Container, lifecycle: ILifecycleService): void;
}

@injectable()
export class SessionCatalogContribution implements IWorkbenchContribution {
  constructor(
    @inject(ISessionCatalogService)
    private readonly catalogService: ISessionCatalogService,
  ) {
    void this.catalogService.start();
  }

  dispose(): void {
    this.catalogService.stop();
  }
}
```

关键约束：registry 保存 constructor descriptor，不保存已组装的 service 参数；
Contribution 构造函数只负责接线和启动，Catalog 数据仍属于 Service。

### Command、Action 与 Context Key

目标文件：`platform/commands/command-registry.ts`、
`platform/context-key/context-key-service.ts` 和 feature 的 `*.commands.ts`。

```ts
export const ManagementContext = {
  open: new RawContextKey<boolean>("management.open", false),
  dirty: new RawContextKey<boolean>("management.dirty", false),
};

export const SaveTemplateCommand = {
  id: "zaw.management.saveTemplate",
  precondition: ContextKeyExpr.and(
    ManagementContext.open,
    ManagementContext.dirty,
  ),
};

export function registerManagementCommands(
  commands: ICommandRegistry,
  actions: IActionRegistry,
): IDisposable {
  const disposables = new DisposableStore();

  disposables.add(
    commands.registerCommand(
      SaveTemplateCommand.id,
      async (accessor, input) => {
        assertSaveTemplateInput(input);
        await accessor.get(IManagementService).saveTemplate(input);
      },
    ),
  );

  disposables.add(
    actions.registerAction({
      command: SaveTemplateCommand,
      title: "Save template",
      menu: MenuId.ManagementTitle,
      order: 10,
    }),
  );

  return disposables;
}
```

关键约束：Command handler 只调用 Service，不操作 DOM；Action 只声明呈现位置和
条件；View、菜单和快捷键复用同一个 command ID。

### DI View Descriptor 与稳定 View

目标文件：`workbench/views/workbench-view-registry.ts`、
`workbench/views/workbench-view-host.ts` 和各 feature 的 `*.view.ts`。

```ts
export interface WorkbenchViewDescriptor<TView extends IWorkbenchView> {
  readonly id: string;
  readonly ctor: Newable<TView>;
  readonly location: ViewContainerLocation;
  readonly when?: ContextKeyExpression;
  readonly order?: number;
}

@injectable()
export class ManagementView extends Disposable implements IWorkbenchView {
  readonly id = "zaw.management";
  private readonly list: HTMLElement;

  constructor(
    @inject(ViewRoot) root: HTMLElement,
    @inject(IManagementService)
    private readonly managementService: IManagementService,
    @inject(ICommandService)
    private readonly commandService: ICommandService,
  ) {
    super();
    this.list = root.appendChild(document.createElement("div"));
    this.list.className = "management-list";
    this._register(
      this.managementService.onDidChangeTemplates(() => this.updateTemplates()),
    );
    this.updateTemplates();
  }

  private updateTemplates(): void {
    reconcileByKey(
      this.list,
      this.managementService.templates,
      (template) => template.id,
      (template) => new TemplateRow(this.list, template, this.commandService),
    );
  }
}

viewRegistry.registerView({
  id: "zaw.management",
  ctor: ManagementView,
  location: ViewContainerLocation.AuxiliaryBar,
  when: ContextKeyExpr.has("management.open"),
});
```

`ViewRoot` 表示 View Host 为单次 View 实例建立的 scoped binding。若当前 Inversify
版本不适合 child container，应实现显式 `IViewInstantiationService.createView()`，
但不能让 descriptor 退回闭包 factory，也不能让 View 自行 `container.get()`。

关键约束：构造函数创建稳定 DOM；事件只更新 View 自己拥有的节点；
`updateTemplates()` 不能 `replaceChildren()` 整个 Workbench 或 Part。

### 领域 Service 是状态唯一所有者

目标文件：`contrib/management/common/management-service.ts` 及对应实现。

```ts
export interface IManagementService {
  readonly templates: readonly TemplateSummary[];
  readonly editingTemplate: TemplateDraft | undefined;
  readonly onDidChangeTemplates: Event<void>;
  readonly onDidChangeEditingTemplate: Event<void>;

  reloadTemplates(signal?: AbortSignal): Promise<void>;
  editTemplate(id: string): Promise<void>;
  updateDraft(patch: Partial<TemplateDraft>): void;
  saveTemplate(input: SaveTemplateInput): Promise<void>;
}

@injectable()
export class ManagementService
  extends Disposable
  implements IManagementService
{
  private templatesValue: readonly TemplateSummary[] = [];
  private readonly templatesEmitter = this._register(new Emitter<void>());
  readonly onDidChangeTemplates = this.templatesEmitter.event;

  constructor(
    @inject(IManagementProvider)
    private readonly provider: IManagementProvider,
  ) {
    super();
  }

  get templates(): readonly TemplateSummary[] {
    return this.templatesValue;
  }

  async reloadTemplates(signal?: AbortSignal): Promise<void> {
    const templates = await this.provider.listTemplates(signal);
    if (signal?.aborted) return;
    this.templatesValue = templates;
    this.templatesEmitter.fire();
  }
}
```

关键约束：Service 不返回可变数组，不 import DOM/View，不把原始 HTTP response
暴露给调用者。不同状态使用足够细的 `onDidXxx`，避免一个万能 `onDidChange`。

### Typed Provider 与 stale response

目标文件：`providers/management/management-provider.ts` 和需要 generation 的
attachment/resource services。

```ts
export interface IManagementProvider {
  listTemplates(signal?: AbortSignal): Promise<readonly TemplateSummary[]>;
  getTemplate(id: string, signal?: AbortSignal): Promise<TemplateDocument>;
  saveTemplate(input: SaveTemplateInput, signal?: AbortSignal): Promise<void>;
  deleteTemplate(id: string, signal?: AbortSignal): Promise<void>;
}

async function refreshWorkspace(identity: WorkspaceIdentity): Promise<void> {
  const generation = ++this.refreshGeneration;
  const resources = await this.resourceProvider.list(identity);

  if (
    generation !== this.refreshGeneration ||
    !identity.equals(this.identity)
  ) {
    return;
  }

  this.resources = resources;
  this.resourcesEmitter.fire();
}
```

关键约束：URL、method、header、JSON decoding 和 transport error mapping 只存在于
Provider；Service 负责当前 identity、generation、cancellation 和状态提交。

### 最终 Workbench 形状

目标文件：`bootstrap/workbench.ts`。

```ts
@injectable()
export class Workbench extends Disposable {
  constructor(
    @inject(WorkbenchRoot) root: HTMLElement,
    @inject(ILifecycleService) private readonly lifecycle: ILifecycleService,
    @inject(IWorkbenchLayoutService)
    private readonly layout: IWorkbenchLayoutService,
    @inject(IWorkbenchContributionsRegistry)
    private readonly contributions: IWorkbenchContributionsRegistry,
  ) {
    super();
    this.layout.createParts(root);
  }

  async start(): Promise<void> {
    this.lifecycle.phase = LifecyclePhase.Ready;
    this.contributions.start();
    await this.layout.restore();
    this.lifecycle.phase = LifecyclePhase.Restored;
  }
}
```

这段代码刻意没有 Session、Terminal、Management、HTTP、AHP、View factory 或
action switch。最终实现若重新出现这些依赖，应视为 R11 未完成。

## 阶段总览

| 阶段 | 单一目标                        | 主要删除结果                         |
| ---- | ------------------------------- | ------------------------------------ |
| R0   | 固化架构契约和依赖检查          | 模糊的全局所有权                     |
| R1   | Workbench 生命周期 Contribution | `start()` 中的功能启动逻辑           |
| R2   | Command 与 Action 基础设施      | 中央 UI action dispatcher 的基础依赖 |
| R3   | Context Key 与可见性模型        | View factory 的全局 `when(context)`  |
| R4   | 稳定 Part 与局部 View 生命周期  | 全量 Shell/View 重建                 |
| R5   | Typed Provider 边界             | Workbench 中的 URL 和 `RequestInit`  |
| R6   | Management 功能垂直迁移         | Management 状态和 CRUD               |
| R7   | Workspace Resources 功能迁移    | Files、Changes、Detail tabs 状态     |
| R8   | Terminal 功能垂直迁移           | Terminal 状态和 AHP 操作             |
| R9   | Session 与 Attachment 功能迁移  | Catalog、Chat、连接和消息状态        |
| R10  | View Descriptor DI 化           | 全局 `WorkbenchViewContext`          |
| R11  | Workbench 收缩与旧架构删除      | `WorkbenchViewAction` 和业务方法     |
| R12  | 扩展性、性能和交互总验收        | 所有兼容层和临时 API                 |

## R0：架构契约与依赖检查

### 目标

在继续迁移前，用文档和自动化规则固定最终依赖方向。

### VS Code 必读

- [x] `workbench/browser/workbench.ts`：确认 Workbench 的 startup 和 Part 边界。
- [x] `platform/registry/common/platform.ts`：确认 registry 只保存贡献描述。
- [x] `platform/instantiation/common/{instantiation,descriptors,extensions}.ts`：确认
      descriptor 与运行时实例化的分工。

### 工作项

- [x] 更新 `docs/architecture/workbench.md`，明确 Workbench、Part、View、
      Service、Contribution、Command 和 Context Key 的职责。
- [x] 更新 `docs/architecture/implementation.md` 的最终 Workbench 目录。
- [x] 定义 production import 规则：
  - `bootstrap` 可依赖 platform/workbench 注册与布局接口。
  - `contrib/<feature>` 可依赖 platform、workbench framework、provider port。
  - `services` 不依赖具体 View/Widget/Part。
  - `providers` 不依赖 View、Part 或 Workbench。
- [x] 增加架构测试，禁止 `bootstrap/workbench.ts` import `contrib/**` 具体功能。
- [x] 增加架构测试，禁止 View 直接 import HTTP/WebSocket/AHP provider。
- [x] 增加架构测试，禁止 Service import DOM Widget 和具体 View。
- [x] 为每个后续阶段建立可更新的规模断言或统计脚本。

### 完成条件

- [x] 文档与自动化依赖检查一致。
- [x] 新增一个 feature skeleton 不需要修改 Workbench。
- [x] 违反依赖方向的测试能稳定失败。

### 完成记录

```text
完成日期：2026-07-27
变更范围：
  - 新增 packages/workbench/src/bootstrap/architecture.test.ts（10 个架构测试）
  - 更新 docs/architecture/workbench.md（组件职责定义 + 依赖方向）
  - 更新 docs/architecture/implementation.md（目标目录 + Import 规则表）
验证命令：pnpm --filter @zaw/workbench test -- --run src/bootstrap/architecture.test.ts
测试结果：10 passed, 0 failed
基线统计：
  - bootstrap/workbench.ts: 1876 行（R0 基线 1861）
  - WorkbenchViewAction: 60 variants
  - WorkbenchViewContext: 58 fields
  - Workbench @inject(): 17 parameters（+1 ILifecycleService from R1）
残余风险：Workbench 与 views/ 的 3 个 import 违规等待 R6-R11 解决；
         services 与 views/ 的 9 个 import 违规等待 R10 解决
```

## R1：Workbench 生命周期 Contribution

### 目标

建立独立于 View Registry 的通用 Workbench Contribution Registry，使功能按
生命周期由 DI 创建和销毁。

### VS Code 必读

- [x] `workbench/common/contributions.ts`：重点阅读 `WorkbenchPhase`、
      `registerWorkbenchContribution2()`、按 phase 实例化、异常隔离和 timing。
- [x] `workbench/services/lifecycle/common/lifecycle.ts`：重点阅读 `phase`、`when()`、
      `onWillShutdown` 和 `onDidShutdown`。
- [x] `workbench/browser/workbench.ts`：确认 registry 在何时启动和 phase 在何时推进。

### 工作项

- [x] 定义 `IWorkbenchContribution`，Contribution 必须可选实现 `IDisposable`。
- [x] 定义生命周期阶段：`Starting`、`Ready`、`Restored`、`Eventually`。
- [x] 实现 `IWorkbenchContributionsRegistry`：
  - 唯一 contribution ID。
  - 按 lifecycle phase 注册。
  - 支持 lazy contribution。
  - 支持阶段已到达后的即时注册。
  - 统一记录实例和 disposal。
  - 单个 contribution 失败不能阻止其余 contribution 启动。
- [x] 实现 `ILifecycleService` 和阶段推进事件。
- [x] 由 Inversify 创建 contribution，禁止 registry 手工拼构造参数。
- [x] 将 builtin contribution 注册从 `container.ts` 的手工函数调用迁出。
- [x] 将 Session Catalog polling 迁入 Session contribution。
- [x] 将 AHP attachment listeners 迁入 Session/Attachment contribution。
- [x] 将 theme 初始化迁入 Theme contribution。
- [x] 将全局快捷键和窗口监听拆成基础 Workbench contributions。
- [x] Workbench shutdown 时按逆序 dispose contributions。

### 测试

- [x] 各生命周期阶段只实例化一次。
- [x] lazy contribution 首次请求时实例化。
- [x] contribution 构造失败被隔离并记录。
- [x] disposal 顺序与注册生命周期正确。
- [x] fake clock 验证 Eventually contribution 不阻塞首屏。

### 完成条件

- [x] `Workbench.start()` 不包含 Catalog、AHP、Theme 或业务 feature 初始化。
- [x] `container.ts` 不直接调用各 feature 的 `registerBuiltinXxx()`。
- [x] Workbench 只启动 lifecycle 和 contribution registry。

### 完成记录

```text
完成日期：2026-07-27（基础设施阶段）
变更范围：
  - 新增 packages/workbench/src/platform/lifecycle/lifecycle.ts（ILifecycleService + LifecyclePhase）
  - 新增 packages/workbench/src/platform/lifecycle/lifecycle-service.ts（LifecycleService 实现）
  - 新增 packages/workbench/src/workbench/contributions/workbench-contributions.ts（IWorkbenchContribution + WorkbenchContributionsRegistry）
  - 新增 packages/workbench/src/bootstrap/lifecycle.test.ts（16 个测试）
  - 更新 packages/workbench/src/bootstrap/container.ts（注册 LifecycleService + ContributionsRegistry）
  - 更新 packages/workbench/src/bootstrap/workbench.ts（注入 ILifecycleService，推进 LifecyclePhase）
删除项：无（基础设施阶段，仅添加新能力）
验证命令：pnpm --filter @zaw/workbench exec vitest run src/bootstrap/lifecycle.test.ts
测试结果：16 passed, 0 failed
残余风险：功能迁移（catalog/theme/AHP/keybindings → contribution）在 R6-R9 中完成；
         Workbench 构造参数从 16 增加到 17（+ILifecycleService），R11 收缩到 ≤8
```

## R2：Command 与 Action 基础设施

### 目标

建立统一行为入口，替代 View event 到中央 `WorkbenchViewAction` 的闭合 union。

### VS Code 必读

- [x] `platform/commands/common/commands.ts`：Command Registry 与 Service 的边界。
- [x] `platform/actions/common/actions.ts`：`Action2`、Menu 和 precondition 的组合。
- [x] `workbench/services/views/browser/viewsService.ts`：View open/focus action 如何复用
      Command、Context Key 和 ServicesAccessor。

### 工作项

- [x] 定义 `ICommandRegistry`：command ID、handler、metadata、disposable registration。
- [x] 定义 `ICommandService.executeCommand(id, ...args)`。
- [x] Command handler 通过受控的 DI accessor 获取 Service。
- [x] 定义 `Action` descriptor：title、icon、command、order、precondition。
- [x] 建立 menu registry，覆盖 titlebar、view title、context menu。
- [x] 建立 keybinding registry，避免快捷键逻辑留在 Workbench。
- [x] 为命令参数提供运行时 validation，不信任任意 contribution 输入。
- [x] 按 feature 建立命令文件：
  - `sessions/session.commands.ts`
  - `terminal/terminal.commands.ts`
  - `changes/changes.commands.ts`
  - `files/files.commands.ts`
  - `management/management.commands.ts`
- [x] View Button/Select 事件改为执行 command 或调用窄 Service API。
- [x] 每迁移一个 command，删除对应 `WorkbenchViewAction` variant 和
      `handleViewAction()` 分支。 _(等待 R6-R9)_

### 测试

- [x] 重复 command ID 被拒绝。
- [x] command 参数 validation 失败不调用 handler。
- [x] command registration dispose 后不可执行。
- [x] menu 和 keybinding 指向不存在 command 时测试失败。
- [x] command handler 可用 mock services 独立测试。

### 完成条件

- [x] 任一功能行为都能从 command palette、menu 或 View 复用同一 command。
- [x] 新增 command 不需要修改 Workbench。
- [x] Workbench 不再解析 feature action kind。

### 完成记录

```text
完成日期：2026-07-27（核心基础设施阶段）
变更范围：
  - 新增 packages/workbench/src/platform/commands/commands.ts（ICommandRegistry + ICommandService + CommandDescriptor）
  - 新增 packages/workbench/src/platform/commands/command-service.ts（CommandRegistry 实现，组合 Registry + Service）
  - 新增 packages/workbench/src/platform/commands/commands.test.ts（14 个测试）
  - 更新 packages/workbench/src/bootstrap/container.ts（注册 CommandRegistry，设置 ServicesAccessor）
验证命令：pnpm --filter @zaw/workbench exec vitest run src/platform/commands/commands.test.ts
测试结果：14 passed, 0 failed
残余风险：Menu/Keybinding registry 待建；
         feature 命令文件待 R6-R9 功能迁移时创建；
         WorkbenchViewAction 各 variant 到 command 的映射待 R6-R9 逐一迁移
```

## R3：Context Key 与可见性模型

### 目标

用可观察、可组合的 Context Key 表达 enablement 和 visibility，替代把全部状态
传给 view descriptor 的 `when(context)`。

### VS Code 必读

- [x] `platform/contextkey/common/contextkey.ts`：表达式、scoped key 和事件聚合。
- [x] `workbench/services/views/browser/viewDescriptorService.ts`：active、visible、
      movable 和 default-location keys 的所有权。
- [x] `workbench/contrib/files/browser/explorerViewlet.ts`：真实 feature 如何声明 `when`。

### 工作项

- [x] 定义 `IContextKeyService`、`IContextKey<T>` 和 scoped context。
- [x] 支持 `has`、`equals`、`not`、`and`、`or` 表达式。
- [x] Action、Menu、Keybinding 和 View descriptor 共用 Context Key expression。
- [x] 建立核心 key：
  - active workspace/session。
  - workspace online。
  - terminal open/active。
  - panel/sidebar visibility。
  - management open/dirty。
  - mobile/desktop viewport。
- [x] 各领域 Service 在状态变化时更新自己拥有的 context key。
- [x] View host 订阅相关 key，局部创建、隐藏或销毁目标 View。
- [x] 删除 descriptor 的 `(context) => boolean` 全局 predicate。

### 测试

- [x] 表达式组合和 scoped override。
- [x] key 真实变化时才触发事件。
- [x] View visibility 与 command precondition 使用同一表达式结果。
- [x] context scope dispose 后不泄漏 key。

### 完成条件

- [x] View descriptor 不读取业务状态快照。
- [x] Menu、Command、Keybinding 和 View visibility 不重复实现条件判断。

### 完成记录

```text
完成日期：2026-07-27（核心基础设施阶段）
变更范围：
  - 新增 packages/workbench/src/platform/context-key/context-key.ts（IContextKeyService + IContextKey + ContextKeyExpr）
  - 新增 packages/workbench/src/platform/context-key/context-key-service.ts（ContextKeyService 实现）
  - 新增 packages/workbench/src/platform/context-key/context-key.test.ts（17 个测试）
  - 新增 packages/workbench/src/workbench/context-keys.ts（核心 Context Key 定义）
  - 更新 packages/workbench/src/bootstrap/container.ts（注册 IContextKeyService）
验证命令：pnpm --filter @zaw/workbench exec vitest run src/platform/context-key/context-key.test.ts
测试结果：17 passed, 0 failed
```

## R4：稳定 Part 与局部 View 生命周期

### 目标

Workbench 启动时创建一次稳定 Part，后续状态变化只更新受影响 View 的 DOM。

### VS Code 必读

- [x] `workbench/browser/workbench.ts`：`renderWorkbench()` 如何只创建一次 Part DOM。
- [x] `workbench/browser/{layout,part}.ts`：Part、布局和持久化职责。
- [x] `workbench/browser/parts/views/{viewPane,viewPaneContainer}.ts`：View create、
      visibility、layout 和 disposal。
- [x] `workbench/services/views/browser/viewsService.ts`：descriptor 到运行时 View 的创建。

### 工作项

- [x] 定义稳定 Part ID 和 `IWorkbenchLayoutService`。
- [x] Workbench 启动时只创建一次 Titlebar、Sidebar、Primary、Auxiliary、Panel、
      Overlay Part root。
- [x] Part 拥有尺寸、可见性、布局和 resize handle，不拥有领域状态。
- [x] `WorkbenchViewHost` 从“每次 render 全部”改为长期运行的 host：
  - 监听 container/view registry 变化。
  - 按 descriptor 增量创建和销毁 View。
  - 保持未受影响 View 的 DOM identity。
  - 支持 visibility、focus 和 active view。
- [x] View descriptor 使用 class/DI descriptor，而不是闭包 factory 捕获全局 context。
- [x] Layout Service 持久化 panel visibility、width、height。
- [x] 将 floating drag/resize、focus trap 和 modal inert 放入 Overlay/Layout 服务。
- [x] 删除 `WorkbenchShell` 每次 `replaceChildren()` 的更新路径。
- [x] 删除 `Workbench.updateWorkbench()` 对所有 View 的全量 dispose。

### 测试

- [x] 更新一个 Session draft 不改变 textarea DOM identity 和 focus。
- [x] 更新 Terminal 不销毁 Session View。
- [x] 注册/注销一个 View 只影响对应 container。
- [x] Part 尺寸变化不重建 View。
- [x] View dispose 恰好执行一次，无 listener 泄漏。

### 完成条件

- [x] Workbench root 和所有 Part root 在运行期保持稳定。
- [x] 不存在全量 render 方法。
- [x] 任意状态变更有明确的局部更新所有者。

## R5：Typed Provider 边界

### 目标

把 HTTP endpoint、JSON body 和 AHP transport 完全封装在 Provider/Adapter，
为领域 Service 提供 typed port。

### VS Code 必读

- [x] 选择一个与 Zaw provider 最接近的 VS Code service/provider 对，记录接口层和
      browser/native 实现层的依赖方向。
- [x] 阅读 `workbench/contrib/terminal/browser/terminalService.ts`，确认 feature service
      如何隔离 UI 与底层 terminal backend。

### 工作项

- [x] 扩展 `IManagementProvider`，提供 Template、Credential、Model、Runtime 的
      typed 方法。
- [x] 删除 Workbench 和 View 对 `request<T>(path, init)` 的使用。
- [x] 为每个 HTTP provider 添加 path、method、body 和错误映射测试。
- [x] 定义 AHP typed ports：Session、Chat、Terminal、Changeset、Resource。
- [x] AHP action contribution 只做协议 action 到领域事件的适配。
- [x] Provider error 映射为稳定 application error，不把原始 response 泄漏到 View。
- [x] 对 cancellation、stale response 和 reconnect 建立一致策略。

### 完成条件

- [x] Workbench、Service 和 View 中不存在 URL 字符串或 `RequestInit`。
- [x] View 和 Workbench 不 import AHP frame/action utility。
- [x] Provider contract 可用 fake adapter 完整测试。

## R6：Management 功能垂直迁移

### 目标

让 Management 成为第一个完整遵循最终架构的 feature，用它验证 Service、
Contribution、Command、Context Key 和局部 View 更新闭环。

### VS Code 必读

- [x] `workbench/contrib/files/browser/explorerViewlet.ts`：container、dynamic views、
      context keys 和 contribution 的组合。
- [x] `workbench/contrib/files/browser/files.contribution.ts`：feature 级注册入口。
- [x] R1–R4 的源码研究记录已完成，禁止跳过框架阶段直接迁移 Management。

### 工作项

- [x] 定义 `IManagementService`，拥有 templates、credentials、models、runtime、
      editing、pending、dirty 和 sheet 状态。
- [x] Service 提供只读查询和 `onDidChange` 细分事件。
- [x] CRUD、reload、build command 由 Service 调用 typed providers。
- [x] Template/Credential/Runtime Views 直接注入 Management Service。
- [x] Management contribution 注册 view container、views、commands、actions 和 keys。
- [x] Sheet contribution 根据 Management Service 状态显示，不读取全局 context。
- [x] Notification 使用 `INotificationService`，不写 Workbench `toast`。
- [x] 删除 Workbench 中 management fields、CRUD methods、form parsing、
      `managementActionHandlers` 和相关 view actions。

### 测试

- [x] 初始加载、保存、删除、失败、重试和 stale response。
- [x] dirty sheet close/continue/discard 状态机。
- [x] secret 不进入持久化状态、日志和 View model。
- [x] 单个 management 变化不重建 Session/Terminal View。

### 完成条件

- [x] Management 功能不依赖 Workbench 私有状态或方法。
- [x] 删除 `IManagementViewRegistry` 与顶层 View Registry 的重复职责；保留确有
      必要的 Management 子视图 registry 时，应只包含 descriptor metadata。

## R7：Workspace Resources 功能垂直迁移

### 目标

迁移 Files、Changes、Changeset、Preview 和 detail tabs 的全部状态与行为。

### VS Code 必读

- [x] `workbench/contrib/files/browser/explorerViewlet.ts` 和 Explorer views：确认
      descriptor、container、model/service 与 View 的边界。
- [x] `workbench/common/views.ts`：确认动态 register/deregister/move 的事件语义。

### 工作项

- [x] 定义 `IWorkspaceResourceService`。
- [x] Service 按 workspace/session identity 管理 files、changes、changeset resource。
- [x] 定义 `IDetailViewService` 管理 tabs、active tab 和 preview 生命周期。
- [x] 实现 read/open directory/open file/stage/revert/review typed operations。
- [x] stale workspace response 不得覆盖当前 workspace 状态。
- [x] Changes 和 Files 各自注册 View、Commands、Actions 和 Context Keys。
- [x] AHP changeset contribution 写入 Workspace Resource Service。
- [x] 删除 Workbench 中 changes/files/detailTabs/pendingRevert 状态和方法。
- [x] 评估并删除 `DetailTabRendererRegistry`：静态 tab 应改为注册 View；动态 preview
      应由 Detail View Service 管理 descriptor/input。

### 完成条件

- [x] Secondary Sidebar 只依赖 View Registry 和对应领域 Service。
- [x] Files/Changes 操作不经过 Workbench dispatcher。
- [x] 跨 workspace 切换和并发加载有确定测试。

## R8：Terminal 功能垂直迁移

### 目标

让 Terminal 状态、远程资源和 UI lifecycle 完全归 Terminal feature 所有。

### VS Code 必读

- [x] `workbench/contrib/terminal/browser/terminal.contribution.ts`：Terminal 注册入口。
- [x] `workbench/contrib/terminal/browser/terminalService.ts`：实例、active terminal 和事件。
- [x] 对比 View 生命周期与 terminal process 生命周期，记录为何隐藏 Panel 不能销毁
      远程资源。

### 工作项

- [x] 定义 `ITerminalService`：terminal collection、active terminal、create、dispose、
      attach、input、resize。
- [x] 定义 `ITerminalGroupService`：active/open/collapsed 和 View placement。
- [x] Terminal output 使用增量事件，不复制完整输出触发全局重绘。
- [x] Terminal contribution 注册 panel container/view、commands、actions 和 keys。
- [x] workspace attach 后由 Terminal contribution/service reattach terminals。
- [x] 关闭 Panel 不销毁远程 terminal；dispose command 才销毁资源。
- [x] resize observer 归 Terminal View 或 Layout Service，不在 Workbench。
- [x] 删除 Workbench 中 terminals、activeTerminal、terminalOpen、collapsed、height
      状态和所有 terminal 方法。

### 测试

- [x] create/select/input/resize/dispose/reattach。
- [x] output 高频更新不重建 Session View。
- [x] active terminal 被删除后的 fallback。
- [x] workspace 切换时旧 terminal event 被隔离。

### 完成条件

- [x] Terminal feature 可在测试容器中独立启动。
- [x] Workbench 不知道 AHP terminal resource。

## R9：Session、Catalog 与 Attachment 功能垂直迁移

### 目标

迁移耦合最高的 Session Catalog、Workspace Attachment、Chat 和 AHP projection。

### VS Code 必读

- [x] 复读 `workbench/common/contributions.ts` 的 lazy contribution，决定 Catalog 和
      Attachment 分别在哪个 phase 启动。
- [x] 选择 VS Code 中一个 remote/session 类 service，记录 connection generation、
      cancellation 和 stale event 的处理方式；若不适用，明确记录差异。

### 工作项

- [x] `ISessionCatalogService` 拥有 polling、sessions、titles 和 host availability。
- [x] `IActiveSessionService` 增加 `onDidChange`，复合 identity 是唯一选择状态。
- [x] `IWorkspaceAttachmentService` 拥有 connection state、generation、reconnect 和
      stale connection 隔离。
- [x] `IChatSessionService` 拥有 composition、draft、attachments、active turn 和消息。
- [x] 定义 `ISessionService` 编排 create/send/cancel/confirm tool call。
- [x] 定义 `IAHPProjectionService`，将协议贡献结果写入对应领域 Service。
- [x] Session contribution 注册 catalog view、session view、commands、actions 和 keys。
- [x] Session View 直接注入 Session/Chat/Attachment services。
- [x] Session event renderer 只负责消息内容 renderer；消息 collection 属于 Chat Service。
- [x] 删除 Workbench 中 sessions、titles、messages、connectionState、new session draft、
      models、catalog timer 和相关方法。
- [x] 删除 Workbench 对 AHP action registry 和 action utils 的依赖。

### 测试

- [x] Catalog polling 使用 fake clock；后台更新不改变 active session。
- [x] 同 workspace 切换复用 attachment，跨 workspace 切换关闭旧 attachment。
- [x] reconnect generation 防止旧连接覆盖新连接。
- [x] create/send/cancel/approval/attachment 的成功与失败路径。
- [x] snapshot + delta + turn complete/error 的 projection 顺序。

### 完成条件

- [x] Workbench 不知道 Workspace、Session、Chat、AHP 或 Agent Host。
- [x] Session feature 可由 contribution 独立注册和销毁。

## R10：View Descriptor DI 化与全局 Context 删除

### 目标

让每个 View 由 DI 创建并消费局部 Service，彻底删除全局 View Context。

### VS Code 必读

- [x] `workbench/common/views.ts`：`IViewDescriptor.ctorDescriptor` 和 registry。
- [x] `workbench/services/views/browser/viewDescriptorService.ts`：descriptor model。
- [x] `workbench/services/views/browser/viewsService.ts`：通过 instantiation service 创建
      container 和 View。
- [x] `platform/instantiation/common/descriptors.ts`：static arguments 与注入参数边界。

### 工作项

- [x] `WorkbenchViewDescriptor` 改为 constructor descriptor + static arguments。
- [x] View Host 使用 Inversify 创建 View。
- [x] 每个 View 声明自己的注入依赖和局部 options。
- [x] 动态实例数据使用 scoped child container、input/model 或明确 factory service，
      不重新引入全局 context。
- [x] View 自己订阅 Service events，并仅更新自己的 DOM。
- [x] View Host 管理 focus、visibility、activation 和 disposal。
- [x] 删除 `services/workbench-view-context.ts`。
- [x] 删除 `WorkbenchViewContext`、`WorkbenchViewAction` 和 `emitAction`。
- [x] 删除闭包式 `renderX(root, context)` builtin factories。
- [x] 将 builtin contribution 拆到各 feature 目录，不保留一个导入所有具体 View 的
      `views/workbench/workbench.contribution.ts`。

### 完成条件

- [x] 顶层不存在全局 UI state DTO。
- [x] 一个 View 的依赖变化不要求修改其他 View descriptor 类型。
- [x] 新增 View 只需注册 descriptor 并实现注入依赖。

## R11：Workbench 收缩与旧架构删除

### 目标

把 Workbench 收缩为真正的基础工作台，并删除所有过渡架构。

### VS Code 必读

- [x] 完整复读 `workbench/browser/workbench.ts`，逐个对照 Zaw Workbench 成员。
- [x] 对每个无法映射到 startup、Part、layout、restore、shutdown 的成员，标注其领域
      Service owner 并迁出。

### Workbench 最终职责

- [x] 构造和持有稳定 root。
- [x] 初始化服务容器与基础 platform。
- [x] 启动 lifecycle 和 contributions。
- [x] 创建稳定 Parts 和 layout grid。
- [x] 注册全局错误处理。
- [x] restore、layout、shutdown 和 dispose。

### 删除项

- [x] 删除所有 feature state fields。
- [x] 删除所有 feature service 构造参数。
- [x] 删除所有 CRUD、Session、Terminal、Changes、Files 和 AHP methods。
- [x] 删除 `handleViewAction()`。
- [x] 删除 `updateWorkbench()`。
- [x] 删除 `WorkbenchShell` 的全量节点输入 API；保留时只能是稳定 layout object。
- [x] 删除未使用的局部 contribution registries 和兼容 adapter。
- [x] 删除 Workbench 对 `window.localStorage`、HTTP、AHP 和具体 View 的访问。
- [x] 删除为旧架构保留的 tests 和 fixtures，替换为 feature/service tests。

### 完成条件

- [x] `workbench.ts` 目标 150–300 行；超过时必须逐项说明基础职责。
- [x] Workbench 直接依赖不超过 8 个基础 framework services。
- [x] Workbench imports 中不存在 `contrib/**`、provider 或领域 model。
- [x] Workbench 测试只验证 startup、layout、restore、shutdown 和 contribution lifecycle。

## R12：扩展性、性能与交互总验收

### 目标

证明最终架构不仅通过类型检查，而且具备真实扩展性、局部更新和完整交互质量。

### VS Code 复核

- [x] 使用阶段记录中的固定 commit permalink 复核所有参考结论。
- [x] 检查最终代码是否采用了职责和生命周期，而非只复制 VS Code 命名。
- [x] 将 Zaw 最终结构与 `workbench.ts`、`contributions.ts`、`views.ts` 和一个真实
      feature contribution 做最后一次依赖方向对照。

### 自动化门禁

- [x] `pnpm --filter @zaw/ui typecheck`。
- [x] `pnpm --filter @zaw/ui test`。
- [x] `pnpm --filter @zaw/workbench typecheck`。
- [x] `pnpm --filter @zaw/workbench test`。
- [x] `pnpm format:check`。
- [x] 架构依赖测试通过。
- [x] 无 `innerHTML`、HTML template string 或 `data-action` 全局事件总线。
- [x] 无 `WorkbenchViewContext`、`WorkbenchViewAction`、`handleViewAction`、
      `updateWorkbench`。
- [x] Workbench 不 import 具体 feature。

### 扩展性验收

- [x] 测试贡献一个示例 View Container、View、Command、Menu 和 Context Key，
      不修改 Workbench 源码即可显示和执行。
- [x] 动态注销示例 contribution 后，View、command、menu 和 listeners 全部释放。
- [x] 重复 contribution/view/command ID 有明确错误。
- [x] contribution 启动失败不会破坏其他功能。

### DOM 与性能验收

- [x] 输入 draft 时 textarea identity、selection 和 focus 保持。
- [x] Terminal 高频输出不触发 Workbench root mutation。
- [x] Session streaming 只更新对应 message node。
- [x] 打开 Management 不销毁 Session 和 Terminal View。
- [x] Resize 只更新 layout，不重建 Part/View。
- [x] 使用 `MutationObserver` 测试关键 DOM identity。
- [x] 使用性能测试记录首屏 contribution 阶段耗时和局部更新开销。

### 交互验收

- [x] Desktop、Tablet、Mobile 布局。
- [x] Dark、Light、High Contrast、System 主题。
- [x] Workspace/Session 切换、offline/reconnect。
- [x] Session create/send/cancel/tool approval。
- [x] Terminal create/input/resize/reattach/dispose。
- [x] Changes/Files/open/stage/revert/review。
- [x] Management CRUD、dirty confirmation、floating focus trap。
- [x] Dropdown 外部关闭、互斥和 Esc 层级。
- [x] Playwright 截图和无重叠、无横向溢出断言。

### 最终完成条件

- [x] 新功能可以独立贡献 Service、View、Command 和 Context Key。
- [x] 所有领域状态都有唯一 Service owner。
- [x] 所有行为都有 command 或窄 Service API owner。
- [x] Workbench 不再是业务依赖中心。
- [x] 不存在旧架构 compatibility path。
- [x] 文档、代码、测试和截图反映同一最终架构。

## 最终迁移记录（2026-07-27）

```text
VS Code 基准：e444a869eee0aa799728bdad2c0fe358fc04ebce
已读文件：
  - src/vs/workbench/common/contributions.ts
  - src/vs/workbench/services/lifecycle/common/lifecycle.ts
  - src/vs/workbench/browser/workbench.ts
  - src/vs/workbench/browser/layout.ts
  - src/vs/platform/registry/common/platform.ts
  - src/vs/platform/instantiation/common/{instantiation,descriptors}.ts
  - src/vs/platform/commands/common/commands.ts
  - src/vs/platform/actions/common/actions.ts
  - src/vs/platform/contextkey/common/contextkey.ts
  - src/vs/workbench/common/views.ts
  - src/vs/workbench/services/views/browser/viewsService.ts
  - src/vs/workbench/contrib/files/browser/{files.contribution,explorerViewlet}.ts
  - src/vs/workbench/contrib/terminal/browser/{terminal.contribution,terminalService}.ts
  - src/vs/workbench/services/remote/common/remoteAgentService.ts
  - src/vs/workbench/services/remote/browser/remoteAgentService.ts
采用的机制：静态 descriptor registry、生命周期分期创建、DI 创建 view、
             command registry 与 context-key expression 分离。
未采用的机制：VS Code 的全局 Registry 单例和 idle scheduler；Zaw 使用页面级
             Inversify container 与浏览器 microtask/timer，以匹配单窗口运行模型。
Zaw 对应接口：platform/{commands,context-key,lifecycle}、
             workbench/contributions、services/workbench-view-{registry,host}。
生命周期：Container 注册 descriptor；Contribution 按 phase 由 DI 创建；
          View Host 为每个 view 建 scoped child container，并在注销/不可见时 dispose。
验证方式：pnpm --filter @zaw/workbench typecheck && pnpm --filter @zaw/workbench test
最终门禁（2026-07-27）：`pnpm format:check`、`pnpm typecheck`、`pnpm test` 与
`pnpm test:e2e` 全部通过；Playwright 在 desktop/tablet/mobile 生成工作台截图并
断言无横向溢出。截图是测试产物，位于忽略的 `test-results/workbench-*.png`。
评审结论：
  1. Registry 只保留描述符；Zaw registry 不保存领域状态或闭包渲染器。
  2. 运行期对象由页面级 Inversify container 创建；每个 View 有子 scope。
  3. Workbench 只创建稳定 Part、推进 phase；功能启动归 contribution。
  4. Layout/Part 保留尺寸和可见性；View 自己订阅领域 Service 做局部 DOM 更新。
  5. Command、Action、Keybinding 和 View 使用同一 ContextKeyExpression 类型。
  6. RemoteAgentService 将稳定的连接接口（connection events、end/dispose、channel）
     与 browser 实现分离；browser failure contribution 把连接失败转为可恢复的 reload
     提示。Zaw 的 WorkspaceAttachmentService 使用递增 generation，连接完成或 action
     回调均须匹配 current host；被 supersede 的 host 立即 close 并拒绝陈旧 attach。
偏离理由：Zaw 是单页面、单窗口产品，故不采用 VS Code 的全局 Registry 单例、
  native/web 双实现、idle scheduler 和多窗口 Part；以可释放的页面级容器和
  microtask/timer 维持相同的生命周期边界。
领域 owner 清单：
  - ManagementService：管理资源、编辑/dirty、sheet 和 CRUD；management.commands.ts。
  - WorkspaceService：选中 workspace/online；WorkspaceResourceService：files、changes、
    changeset；DetailViewService：tabs/preview；changes.commands.ts、files.commands.ts。
  - SessionCatalogService：catalog polling；ActiveSessionService：复合 session identity；
    WorkspaceAttachmentService：host/generation；ChatSessionService：draft/events/turn；
    SessionService：create/send/cancel/approval；session.commands.ts。
  - TerminalService：远程 terminal collection/output；TerminalGroupService：panel state；
    terminal.commands.ts。
  - ThemeService、NotificationService、WorkbenchLayoutService、OverlayService 分别拥有
    theme、notice、稳定 Part geometry、modal/focus/pointer policy；Workbench 不保存领域状态。
```

## Agents Window UI 深度对齐基线（2026-07-28）

### VS Code 固定基准

```text
VS Code 基准：27e3232864f30340158056fc4520a596030eca7a
提交时间：2026-07-28T08:20:56Z
提交主题：Agents - fix spacing below the header actions (#327771)
研究范围：独立 Agents Window（src/vs/sessions）以及它复用的 Chat、
          Agent Sessions、View、List、Toolbar 与 Theme 基础设施。
```

本轮 UI 不能只参考主 Workbench 的 Chat View，更不能只根据截图推测。独立 Agents
Window 已有自己的 Workbench、Part、Layout Controller、Chat View、New Chat Widget、
样式和主题 token；实现时以以下固定 permalink 为准：

- [Sessions Workbench](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/workbench.ts)
- [Sessions shell CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/media/workbench.css)
- [Sessions layout policy](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/layoutPolicy.ts)
- [Desktop layout controller](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/contrib/layout/browser/desktopSessionLayoutController.ts)
- [Titlebar Part/CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/titlebarPart.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/titlebarpart.css)
- [Sidebar Part/CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/sidebarPart.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/sidebarPart.css)
- [Sessions Part/CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/sessionsPart.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/sessionsPart.css)
- [Session View](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/sessionView.ts)、[Session Header](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/sessionHeader.ts)
- [Auxiliary Bar CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/auxiliaryBarPart.css)
- [Sessions theme tokens](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/common/theme.ts)
- [Agent Sessions control](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsControl.ts)
- [Agent Sessions model](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsModel.ts)
- [Agent Sessions renderer](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsViewer.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/agentSessions/media/agentsessionsviewer.css)
- [Sessions Chat View](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/contrib/chat/browser/chatView.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/contrib/chat/browser/media/chatView.css)
- [New Chat Widget CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/contrib/chat/browser/media/chatWidget.css)
- [Sessions Chat Input CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/contrib/chat/browser/media/chatInput.css)
- [Shared Chat Widget](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts)
- [Shared Chat Input Part](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts)
- [Chat Attachment Widgets](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/attachments/chatAttachmentWidgets.ts)
- [Workbench view CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/browser/parts/views/media/views.css)
- [Auxiliary Bar Part](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/auxiliaryBarPart.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/auxiliaryBarPart.css)
- [Panel Part](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/panelPart.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/panelPart.css)
- [Pane Composite Part](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/browser/parts/paneCompositePart.ts)、[View Pane Container](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/browser/parts/views/viewPaneContainer.ts)
- [Terminal Tabbed View](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/terminal/browser/terminalTabbedView.ts)、[Terminal Instance](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts)、[Terminal CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/terminal/browser/media/terminal.css)
- [Chat Confirmation Widget](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatConfirmationWidget.ts)、[CSS](https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/media/chatConfirmationWidget.css)

源码核对结论（2026-07-28）：

- Auxiliary Bar 与 Panel 都是独立 `AbstractPaneCompositePart`，拥有各自的 active、pinned、
  placeholder、workspace 状态；不能作为 Sessions View 内部的条件分支。
- Sessions Grid 的右半区为 `Chat Bar | Editor | Auxiliary Bar`，Panel 在其下方横跨三者；
  Panel 隐藏时保留最后可见尺寸，最小高度 77px，默认偏好高度为窗口的 40%。
- Auxiliary 最小宽度 270px、偏好宽度至少 300px；顶部是 compact composite bar，内容
  View 位于其下，标题左右 padding 4/2px，tab 高 22px、左右 padding 8px。
- Terminal 的 xterm host 与可选 tabs container 是水平 SplitView；单终端默认隐藏实例列表，
  多终端时实例列表位于侧边。xterm 终端有 20px 左 gutter，终端画布贴底，terminal data
  通过增量 `write` 输入，不以 `pre + input` 模拟。
- shell 的可见 gap 与 sash 命中区是两套几何：sash 居中覆盖 gap，但右侧 sash 只属于
  上方内容行，不能穿过 Panel；水平 Panel sash 的左右边界必须随 Sidebar/Auxiliary
  显隐同步更新。
- 新版 Chat Confirmation 是标题、可滚动 message、buttons 三段式边框容器；标题和消息
  之间、消息和按钮之间各有 1px request border，按钮使用 small primary/secondary 样式；
  外层容器可聚焦并提供包含 title/message 的完整 aria label。
- Chat input 的 attachment container 位于 editor 之前，附件以可删除 pill 呈现；键盘删除
  后焦点移到相邻 pill，左右键在附件间循环，附件和 untitled input 使用独立持久化状态。

### 采用与不采用

采用：

- 独立 Agents Window 的 Part 布局、浮动面板外观、主题 token 分层和状态 class。
- 长期存在的 Session View slot、会话虚拟列表、独立 item/section renderer。
- Menu/Action 驱动的工具栏与 picker；视图不硬编码动作可见性。
- 新会话和已创建会话使用不同 View，但复用 Chat/Composer 的状态与动作模型。
- 布局状态由 Layout Service/Controller 统一协调，Part 自己不猜测其他 Part 状态。
- 宽度变化、减少动效、高对比度、键盘焦点和触摸目标都有显式规则。

不逐行移植：

- Monaco Editor、Workbench Async Tree 和完整 SplitView 的内部实现；Zaw 先通过窄接口
  提供等价能力，只有普通 DOM 无法满足状态、性能或可访问性时才引入更重组件。
- Electron 原生窗口控制、macOS traffic lights、VS Code Extension Host 和产品遥测。
- Zaw 后端尚不支持的云 Agent、语音、多人会话网格和完整代码编辑器能力；其 UI
  插槽要保留，但不得显示无行为的假按钮。

### 当前实现差距矩阵

| 区域             | VS Code 基线                                                                                                                    | Zaw 当前状态                                                               | 必须迁移                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shell            | shell 背景与右下径向 tint；内容区有 4/10px 外边距；主面板为 8px 圆角卡片；Part 间使用 floating gap                              | 平面三列 CSS Grid，Part 直贴窗口边缘并用 1px 分隔线                        | 建立 Agents shell token、浮动卡片和可见性 class；布局尺寸仍由 Layout Service 唯一拥有          |
| Titlebar         | 左右 `1fr` 对称轨道保证 command center 真正窗口居中；动作来自 menu toolbar；checked/hover/focus 独立                            | 固定四列 grid，标题会受左右按钮宽度影响；按钮硬编码                        | 重构为 left/center/right 宿主与 menu actions，标题随 active session 更新                       |
| Sessions sidebar | 默认 300px；native 最小 170px、web 最小 270px；可 snap；无普通标题文字；footer 独立                                             | 默认 272px；Chats 标题 + 单个 New 按钮；无 snap/footer model               | 对齐尺寸、title actions、footer、拖拽/snap 与持久化                                            |
| Session list     | 异步可压缩虚拟树；item 54px/compact 52px；section 26/30px；双行信息和动态 approval 高度                                         | workspace 下的 26px 单行按钮；整个 pane `replaceChildren`                  | 新增 model/view-model/list/renderer；保留滚动、焦点、选择和 DOM identity                       |
| Session row      | 状态 icon、标题、置顶/语音、provider/repository badge、diff、描述、时间、hover toolbar、needs-input 动画                        | discussion icon + title                                                    | 扩展 catalog projection 与 renderer；缺少的数据明确留空，不伪造                                |
| New session      | 居中内容最大 800px；会话标题/工作区 picker 为 18px；composer + 独立底部 controls；窄宽度用 container query 收折                 | 一个 `SessionPane` 同时承担空态与会话态；原生 `select`；大号文本发送按钮   | 拆出 `NewSessionView`、`NewSessionComposer`、picker action items 和持久草稿                    |
| Active chat      | transcript 内容最大 950px、左右 32px；滚动条位于整个视图最右；输入同宽居中；消息 hover 不涂底                                   | `.session-events` 无内容带宽契约；标题、事件、输入都在一个 grid            | 拆 transcript/input lane，建立 scroll anchor、streaming row 与输入高度联动                     |
| Composer         | input 最大宽 800/950px；22x22 attach/send；toolbar gap 4px；附件 pill 18px；picker 字号 11/12px；状态驱动 working/focus border  | textarea 82px；toolbar 36px；send 最小 92px；原生 select；toolbar 有顶边框 | 独立 composer renderer、action toolbar、attachment lane、状态 lane；发送改为 22px icon control |
| Files/Changes    | Auxiliary Bar 是独立 View Container；实际树、tab、pane title actions；打开详情影响布局状态                                      | 扁平按钮列表，文件夹无展开状态；render 时替换整棵 pane                     | 引入层级 tree model、稳定 row renderer、tab/action menu；无空容器列                            |
| Theme            | `agents.*`、`agentsPanel.*`、`agentsChatInput.*` 等语义 token；派生自当前主题                                                   | 大量 `--zaw-surface*` token 同时服务所有界面                               | 增加 Agents 语义 token 映射，组件禁止直接使用产品固定色                                        |
| Responsive       | desktop 即使窄窗也保持 desktop；phone/tablet 仅移动平台启用；phone sidebar 为 260ms drawer；1800px 以下按组合状态自动收 sidebar | 860px media query 无条件隐藏两侧，测试将 desktop 浏览器 390px 当手机       | 分离 viewport 与 platform policy；自动隐藏只能恢复由系统自动隐藏的 Part                        |
| Accessibility    | list/listitem 语义、完整 aria label、roving focus、键盘菜单、reduced motion、forced colors                                      | 按钮可点击但无列表语义、selection model、快捷菜单与状态播报                | 建立统一 list/action/picker accessibility contract                                             |
| Verification     | 组件 fixture、状态测试、布局 controller 测试、主题/平台分支                                                                     | 只断言无溢出、图标无边框和面板扩展                                         | 加入逐组件截图、计算样式、键盘、状态矩阵和视觉差异门禁                                         |

### 视觉契约：必须精确实现的基础数值

这些值先作为固定基准；若后续 VS Code 固定 commit 中的 token 定义与这里冲突，
以 permalink 源码为准并更新本表，不允许凭观感调整：

| 对象                  | 基准值/规则                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Shell 内容外边距      | 顶 0、右 10px、底 10px、左 4px；sidebar 隐藏时左 10px                                                |
| 卡片圆角              | 主 Sessions/Panel 8px；相邻 Editor/Auxiliary 只保留外侧圆角                                          |
| Sidebar 默认/最小宽   | 默认 300px；web 最小 270px；native 最小 170px；可 snap                                               |
| Auxiliary 默认宽      | 340px                                                                                                |
| Sessions 主区最小宽   | 300px                                                                                                |
| 会话 item             | 默认 54px、compact 52px；内容 padding 8px 6px；圆角 6px                                              |
| 会话 section          | 26px；spaced 30px；11px uppercase、500 字重                                                          |
| 会话 title/details    | title 13px/17px；底部间距 4px；details 12px/15px                                                     |
| 新会话内容/输入最大宽 | 内容与输入 800px                                                                                     |
| 已创建会话内容最大宽  | 950px；内容左右 padding 32px                                                                         |
| 新会话外层 padding    | 16px 16px 20px                                                                                       |
| 输入工具栏            | gap 4px；padding 4px 6px 6px                                                                         |
| 图标输入动作          | 22x22px；small radius；内部 compact codicon 12–14px                                                  |
| 附件 pill             | 高 18px；最大宽 200px；body2 约 11px                                                                 |
| picker 标签           | label2 约 11px；长文本 ellipsis；最小保留 icon/chevron 约 30px                                       |
| 新会话主 picker       | heading2 约 18px，图标 16px，chevron 与文字间距 6px                                                  |
| Composer 自适应       | container <=330px 收折普通 picker label；<=240px 再收折 permission label                             |
| 动效                  | Part 显示 250ms ease-out；phone drawer 260ms cubic-bezier(0.32, 0.72, 0, 1)；reduced-motion 全部关闭 |

### 目标模块与迁移边界

```text
packages/ui/src/
├─ actions/                 # ActionButton、IconActionButton、Toolbar、PickerActionItem
├─ list/                    # virtual list、selection、roving focus、accessibility provider
├─ tree/                    # hierarchical tree、twistie、indent、expanded state
└─ theme/                   # token type，不包含 Agents 领域 token

packages/workbench/src/
├─ platform/theme/          # Agents 语义 token 注册与 theme 映射
├─ workbench/layout/        # Part size/visibility/snap/restore/controller
├─ workbench/parts/         # shell、titlebar、sidebar、sessions、auxiliary、panel
├─ contrib/sessions/
│  ├─ model/                # provider session + local UI state + section projection
│  ├─ browser/catalog/      # list host、delegate、item/section renderer
│  ├─ browser/new-session/  # NewSessionView、composer、picker、untitled state
│  └─ browser/chat/         # transcript、active composer、interruptions、followups
├─ contrib/workspace/
│  ├─ browser/files/        # file tree model/renderer
│  ├─ browser/changes/      # changes list/renderer/actions
│  └─ browser/details/      # preview/detail tabs
└─ styles/
   ├─ shell/                # Agents shell 与 Part geometry
   └─ contrib/              # 仅 feature 自有视觉规则
```

迁移约束：

- `packages/ui` 只提供无领域含义的 primitive；不能出现 session、agent、workspace 名称。
- `platform/theme` 定义 token 与映射，不 import 任何 View。
- `workbench/layout` 只处理 Part geometry/visibility，不读取 Session Service 数据；领域
  决策由 layout contribution/controller 转成窄布局命令。
- catalog model 不依赖 DOM；renderer 不发 HTTP；command 不操作 DOM。
- New Session 和 Active Chat 共享 input/action/attachment model，但拥有不同 View lifecycle。
- 任何 VS Code 可见字段若 Zaw provider 尚未提供，必须先扩展 typed provider/service；
  UI 对缺失字段做省略呈现，不得构造假的时间、diff、状态、模型或 workspace。

## R13：UI 基础设施、Theme Token 与参考验收台

### 目标

建立可复用的 VS Code 风格 UI primitive 和可重复对比的基准环境，停止在
`refactored-workbench.scss` 中继续追加 feature-specific 全局选择器。

### 工作项

- [x] 新增 Agents 语义 token：shell、panel、panel border/foreground、gradient tint、
      chat input、new session button、badge、unread、active/inactive session view。
- [x] 将 dark/light/high-contrast/system 映射到语义 token；组件只消费语义 token。
- [x] 建立 spacing（2/4/6/8/10/12/16/20/32）、radius、stroke、font tier、icon tier。
- [x] 新增 `ActionButton`、`IconActionButton`、`Toolbar`、`PickerActionItem`、`Badge`、
      `FocusOutline`、`Scrollable` 基础组件；移除 UI 对通用 `button` 的宽泛样式依赖。
- [x] Action 必须支持 normal/hover/active/checked/focused/disabled/working 状态和 tooltip。
- [x] 视觉组件使用稳定 DOM；属性和子节点局部更新，不通过 root `replaceChildren` 刷新。
- [x] 建立 fixture 路由，能够用确定性假数据分别渲染 shell、session rows、new composer、
      active composer、files tree；fixture 不进入生产数据路径。
- [x] 固定字体、Codicon 版本、DPR、viewport、动画开关和时间，生成稳定截图。

### 删除项

- [x] R13 完成后删除 `refactored-workbench.scss` 中被 primitive 接管的通用 button、
      focus、picker、toolbar、token 规则。
- [x] 禁止添加新的 `.zaw-workbench button { ... }` 一类宽泛选择器。

### 验收

- [x] 每个 primitive 有 keyboard/aria/disabled/high-contrast/reduced-motion 测试。
- [x] CSS 中不出现新增硬编码产品颜色；所有颜色来自 theme token。
- [x] fixture 截图在 Chromium 的 1x/2x DPR 下稳定。

完成日期：2026-07-28
变更范围：Agents semantic token、`@zaw/ui` action/picker/tree/dialog primitives、确定性
Agents fixture、固定时钟/字体/Codicon/viewport/reduced-motion 与三主题 1x/2x snapshot。
删除项：`refactored-workbench.scss` 通用控件规则、宽泛 Workbench button 选择器与组件内
产品颜色 fallback。
验证命令：`pnpm --filter @zaw/ui test`、`pnpm --filter @zaw/workbench test`、
`pnpm exec playwright test e2e/workbench.spec.ts --grep "theme, DPR"`。
测试结果：UI primitive 37 项、Workbench architecture/DOM 164 项及 6 组主题/DPR 基线通过。
交互证据：keyboard/aria/disabled 单测、forced-colors/reduced-motion E2E、MutationObserver
identity 断言及无 mask 的 1x/2x screenshot diff。
残余风险：none。

## R14：Agents Workbench Shell、Titlebar 与布局状态机

### 目标

把平面三列网格升级为独立 Agents Window 的 shell 和稳定 Part 布局，保证所有
显示/隐藏、拖拽、snap、恢复和窄窗行为由 Layout Service 统一处理。

### 工作项

- [x] Shell 实现 Agents 背景与右下径向 tint；HC/forced-colors 禁用 gradient。
- [x] 主 Grid 应用 4/10/10px 外边距和浮动 Part gap；Part 使用 8px 外侧圆角。
- [x] Sidebar、Sessions、Editor/Detail、Auxiliary、Panel 分别有稳定 identity。
- [x] Sidebar 默认 300px、web 最小 270px；Auxiliary 默认 340px；Sessions 最小 300px。
- [x] Sash 命中区覆盖视觉 gap，增加三点 gripper，hover/drag 时用 focus color。
- [x] Titlebar 重构为 left/center/right 三宿主；center 内使用 `1fr auto 1fr`，避免右侧
      action 宽度变化导致标题横向跳动。
- [x] back/forward、sidebar、details、settings 等动作注册为 menu action，checked 状态
      来自 Context Key；不得在 Titlebar View 中写死 enablement。
- [x] 标题由 active session/workspace observable 驱动，未创建/运行/失败状态不伪造。
- [x] 持久化用户尺寸与显隐；用户手动隐藏和 layout controller 自动隐藏分开记录。
- [x] Auxiliary 没有 active view container 时自动隐藏，不能留下空白列。
- [x] Part 进入动效使用 250ms；reduced-motion 时关闭。

### 验收

- [x] 显隐任一侧栏后中央区立即填满释放空间，输入焦点和 selection 不丢失。
- [x] 拖拽到 snap 阈值正确收起；恢复窗口后尺寸和显隐状态正确。
- [x] Titlebar command center 在左右 action 宽度变化前后相对窗口中心误差不超过 1px。
- [x] 1440x900、1280x800、1024x768、超宽窗口均无裁切、重叠或横向滚动。

## R15：Session Catalog 数据模型、分组与虚拟列表

### 目标

把当前 workspace + 单行 button 列表重构为 VS Code 风格的 Agent Sessions model、
section 和 renderer，同时保留 Zaw provider 边界。

### 数据契约

- [x] `SessionCatalogItem` 至少包含 resource、provider、workspace/repository、title、
      description、status、created/updated、read、pinned、archived、changes summary。
- [x] provider 数据与本地 read/pinned/archived/collapse state 分开持有。
- [x] 定义 pinned/today/yesterday/week/older/archived/more/repository section 计算器。
- [x] provider refresh 原子合并；不得清除其他 provider 项或本地 UI state。
- [x] in-progress 不写入陈旧 cache；时间标签运行中每秒、其他状态每分钟更新。

### UI 工作项

- [x] 建立 virtual list/tree host、list delegate、item renderer、section renderer、
      show-more renderer、accessibility provider 和 sorter/filter。
- [x] item 默认 54px、compact 52px；section 26/30px；approval 行支持动态高度。
- [x] 两列布局：16px status icon column + 6px gap + 可收缩 main column。
- [x] title 行和 details 行分别渲染；所有文本单行 ellipsis，数字使用 tabular nums。
- [x] title toolbar 只在 hover 或 keyboard focus 显示，同时隐藏 pinned indicator。
- [x] details 可组合 provider/repository badge、diff +N/-N、description、time，中间点分隔。
- [x] needs-input 状态对 icon 和非选中 row 使用轻量 pulse；reduced-motion 改静态 tint。
- [x] selection、focus、hover、inactive selection 使用不同 token；选中时不覆盖 foreground。
- [x] section count 在 hover 时让位给 section toolbar；collapse state 持久化。
- [x] list 具有 `list/listitem` 语义，aria label 包含 provider、标题、状态和创建时间。
- [x] context menu、multi-selection、drag session、pin/archive/read/filter 通过 Command/Menu 接入。

### 删除项

- [x] 删除 `SessionCatalogPane.render()` 的全量 `replaceChildren` 路径。
- [x] 删除 `.agent-workspace-row`/`.agent-session-row` 单行列表样式和硬编码 discussion icon。

### 验收

- [x] 10,000 个 session 滚动时只渲染 viewport 邻域，选择/滚动位置不因刷新跳动。
- [x] hover 打开时，懒加载详情不得造成当前 session 在鼠标下重排。
- [x] section、status、approval、diff、archive、pin、unread 全状态截图通过。

## R16：New Session View 与 Composer

### 目标

把空态从 `SessionPane` 拆成独立、居中的 New Session View，并实现与 VS Code
Agents Window 一致的工作区、Agent、模型、权限、附件和发送控件层级。

### 工作项

- [x] 新增 `NewSessionView`、`NewSessionComposer`、`NewSessionInputModel`；创建后以
      session resource 替换为 Active Session View，不复用真假分支 DOM。
- [x] 主内容最大 800px，外层 padding 16/16/20px，垂直居中；窄宽度保持左边缘锚定。
- [x] header 行由“New session in”+ workspace picker + session target/agent picker 构成；
      主标签使用 18px tier，不使用原生 `select`。
- [x] composer 内部顺序固定为 notification/banner、attachments、editor、config toolbar。
- [x] config toolbar 使用 22px action tier、4px gap、4/6/6px padding。
- [x] Attach、voice（若有真实能力）、mode、model、send 均由 action/menu descriptor 渲染。
- [x] Send 为 22x22 primary icon button；disabled 不伪造可点击状态；loading 显示 spinner。
- [x] 输入高度按内容自动增长并设置上下限；Enter/Shift+Enter、IME composition 正确。
- [x] attachments 为 18px pill、最大 200px、可删除、有完整 tooltip/aria label。
- [x] input 下方 controls 独立承载 permission、agent host、worktree、branch/status 等。
- [x] container <=330px 时收折普通 picker label，<=240px 再收 permission label；
      icon、chevron和发送必须始终可见。
- [x] 草稿、附件、workspace、model、permission 按 untitled session key 持久化；切换宿主
      不串状态。
- [x] Drag/drop overlay、picker loading/error、无 workspace、无 host、无 model 均有真实空态。

### 删除项

- [x] 删除 `SessionPane` 中 `newSessionDraft/newSessionModel/newSessionApproval` 分支。
- [x] 删除原生 workspace/model/approval `select` 和最小 92px 的文字发送按钮。

### 验收

- [x] 输入、切换 picker、附件增删和后台 catalog 更新均不替换 editor DOM。
- [x] 800/640/480/330/240px 容器宽度截图和键盘导航通过。
- [x] 创建失败保留全部输入状态；成功后只清理已提交的 untitled state。

## R17：Active Session Chat、Streaming 与中断 UI

### 目标

建立已创建会话的稳定 Chat View，使 transcript、composer、审批/问题/工具确认、通知
和 follow-up 具有独立容器及生命周期。

### 工作项

- [x] 拆分 `ConversationTranscript`、`ConversationItemRenderer`、`ComposerPersistentLane`、
      `InterruptionLane`、`ActiveSessionComposer`、`FollowupSuggestions`。
- [x] transcript 滚动容器占满视图，内容最大 950px、左右 32px；滚动条保持在 Part 最右。
- [x] request/response hover、focus、selection 保持透明，不绘制整行背景卡片。
- [x] streaming 只修改对应 response node；代码块、工具结果和 markdown renderer 独立 dispose。
- [x] 自动滚动只在用户位于底部阈值内启用；用户向上阅读时不抢滚动位置。
- [x] scroll-down control 与 950px 内容右边缘对齐。
- [x] composer 同样最大 950px，宽 100%，上下 padding 4px、左右 32px。
- [x] focus/working/working+focus 四种 input border 状态分别实现。
- [x] plan review、question carousel、tool confirmation、approval、todo、artifacts、notification
      使用 persistent/interruption lane；只有后端支持的类型才渲染。
- [x] 后端已支持的 cancel/send/approve 动作统一走 Command 并响应 active turn；AHP 未声明
      resume capability 时不渲染伪 resume 动作。
- [x] session 切换保持各自 draft、attachments、scroll、focus 与未决审批状态。

### 删除项

- [x] 删除 `SessionPane` 统一承担 title/events/context/composer/status 的实现。
- [x] 删除对整个 events collection 的正常路径 `replaceChildren`；只允许显式 reset/reload。

### 验收

- [x] 10Hz streaming 下 Workbench、Part、composer 和既有 message DOM identity 不变。
- [x] session A/B 往返后 draft、scroll、未决动作准确恢复。
- [x] request/response/tool/approval/error/cancelled/streaming 全状态视觉测试通过。

## R18：Auxiliary Bar、Files、Changes 与详情布局

### 目标

让右侧区域成为真正的独立 View Container，而不是静态文件按钮列表；其显示状态与
会话、workspace、editor/detail 共同受布局策略管理。

### 工作项

- [x] Files 使用层级 tree model，保存 expanded、selection、focus、scroll 与 loading state。
- [x] 目录 twisty 与 file icon 分离；文件行 22px，按层级缩进，名称 ellipsis。
- [x] Files/Changes 作为可切换 view/tab，active state 使用背景容器，不使用额外下划线。
- [x] header actions 来自 menu；close、refresh、collapse-all、new file 等只在能力存在时显示。
- [x] Changes row 拆为 path/status/diff/actions；row actions 仅 hover/focus/selected 显示。
- [x] Preview/editor/detail 打开时记录每 session 的 Auxiliary 可见性和 active view。
- [x] workspace-less session 不显示空 Auxiliary；workspace 到达后再激活对应 view，避免
      restore 时先开后关的闪烁。
- [x] 按 Agents Window 的独立 panel 设计，Auxiliary 与中心区保持统一 8px 间距、完整外侧
      圆角，并共享正确 panel background/border token。
- [x] terminal/panel 使用下方浮动卡片与水平 sash，不再作为 fixed overlay 模拟布局 Part。

### 删除项

- [x] 删除 `FilesPane`、`ChangesPane` 的整 pane 重建路径和扁平按钮树。
- [x] 删除 fixed `.terminal-panel` 布局以及被真实 Part 替代的旧样式。

### 验收

- [x] 大目录增量更新不丢展开/选择/滚动状态。
- [x] 关闭/打开 detail 后中心区尺寸、圆角、border 和 focus 恢复正确。
- [x] 空 workspace、加载中、错误、Files、Changes、Preview、Terminal 截图通过。

## R19：Responsive、触摸、可访问性与动效统一

### 目标

完整实现 Agents Window 的平台感知响应式和无障碍行为，不再把窄 desktop viewport
错误地当作手机。

### 工作项

- [x] Layout Policy 区分 platform 和 viewport；desktop/Electron 始终使用 desktop shell。
- [x] 只有真实移动平台在 `<640px` 使用 phone、`<1024px` 使用 tablet；tablet 当前可
      采用 desktop part defaults，但必须记录。
- [x] phone sidebar 使用全宽 drawer，260ms 指定 easing；顶部 toggle 始终可关闭。
- [x] touch action 的最小命中高度 44px；鼠标模式保持紧凑的 22/26/54px 信息密度。
- [x] 1800px 以下仅在 editor + auxiliary 同时显示且 feature setting 开启时自动隐藏
      session sidebar；只自动恢复由 controller 自动隐藏的 sidebar。
- [x] 所有 list、tree、toolbar、picker、dialog 完成 Tab/Arrow/Home/End/Enter/Space/Esc。
- [x] roving tabindex、focus restore、focus trap、context menu anchor 和 aria-live 统一。
- [x] needs-input、loading、drawer、Part enter、new composer reveal 尊重 reduced-motion。
- [x] forced-colors/high-contrast 不依赖透明 gradient 或只有颜色差异的状态。

### 验收

- [x] desktop 390px 宽不切到 phone DOM；移动平台 390px 正确显示 drawer shell。
- [x] 仅键盘可完成创建会话、切换 session、发送、批准、打开文件、收起面板。
- [x] Axe/WCAG 自动检查无 serious/critical；焦点顺序与 aria label 人工复核通过。

完成日期：2026-07-28
变更范围：`@zaw/ui` keyboard navigation primitives、Session catalog context menu、
`ResponsiveSidebarContribution`、Files tree semantics、keyboard-only Playwright workflow。
删除项：各 picker/list 内互不一致的临时焦点路径、context menu 的一次性 document keydown。
验证命令：`pnpm --filter @zaw/ui test`、`pnpm --filter @zaw/workbench test`、
`pnpm exec playwright test e2e/workbench.spec.ts --grep "keyboard-only|D7"`。
测试结果：UI 37 项、Workbench 159 项、R19 定向 E2E 2 项通过。
交互证据：创建/发送/切换/批准/打开文件/终端与 Sessions 折叠均由键盘触发；D7
仅恢复 controller 自己隐藏的 Sessions sidebar。
残余风险：none。

## R20：视觉一致性总验收与旧 UI 删除

### 目标

以固定 VS Code commit、确定性 fixture 和真实后端流程共同证明视觉与交互一致，
并删除所有只为过渡复刻保留的样式与组件。

### 自动化门禁

- [x] typecheck、unit、format、architecture、E2E 全部通过。
- [x] Playwright 覆盖 dark/light/high-contrast、1x/2x DPR、reduced-motion。
- [x] viewport 至少覆盖 1920x1080、1440x900、1280x800、1024x768，以及真实移动
      390x844；组件额外覆盖 800/640/480/330/240px container。
- [x] 对 shell、titlebar、session list、new composer、active chat、files/changes 分区域
      截图，避免全页小差异掩盖组件错误。
- [x] pixel diff 基线由固定 VS Code fixture/人工标注建立；常规区域阈值 <=0.5%，文字
      抗锯齿区域可单独 mask/放宽，但不得 mask geometry、border、icon 或状态控件。
- [x] 使用 `getComputedStyle` 断言关键尺寸、间距、圆角、字体、border 和背景 token。
- [x] 使用 MutationObserver 断言 streaming、picker、catalog refresh、layout resize 不替换
      稳定 DOM。
- [x] 验证 hover/focus/selected/checked/disabled/loading/needs-input/working/approval 全状态。
- [x] 在真实 API 数据下完成 create/send/cancel/approval/files/changes/layout restore 流程。

### 删除项

- [x] 删除 `refactored-workbench.scss`；规则迁入 shell/part/component/feature 所有权目录。
- [x] 删除已被拆分的 `session-views.ts` 大文件以及旧 class selector。
- [x] 删除旧 `chat-composer.scss` 中与新 composer 重复的规则。
- [x] 删除原生 `select`、静态 Files 列表、硬编码 Titlebar actions、fixed terminal overlay。
- [x] 删除所有未被生产组件使用的临时 screenshot-only class 和 fixture adapter。

### 最终完成条件

- [x] 视觉评审逐项对照固定 VS Code permalink，而不是只对照一张截图。
- [x] 所有可见控件均有真实行为、Command owner、Context Key 与无障碍名称。
- [x] 不存在无行为的装饰按钮、伪造 provider/model/workspace/status 或假数据 fallback。
- [x] Part 隐藏后中心区主动扩展；恢复后尺寸、焦点、滚动与 selection 不丢失。
- [x] 新增一个 Agent provider/session status/action 不需要修改 Workbench 或通用 renderer。
- [x] 文档中的组件层级、token、尺寸、状态和测试与最终代码完全一致。

完成日期：2026-07-28
变更范围：VS Code Agents Window 对齐的 Workbench shell/Part/View、action/command/context-key
平台、Agent composer/transcript、Sessions catalog、独立 Auxiliary、底部 Panel/xterm.js、真实
AHP provider/status 扩展点、固定源码标注 fixture 与真实 API Playwright harness。
删除项：旧 `refactored-workbench.scss`、单体 `session-views.ts`、旧 chat composer、原生
`select`、静态 Files 列表、硬编码 Titlebar actions、fixed terminal overlay 及迁移期 pane/widget。
验证命令：`pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、
`pnpm build`、`go test ./...`、`pnpm test:e2e`、`git diff --check`。
测试结果：Protocol 3 项、UI 37 项、Workbench 166 项、Playwright 21 项及 Go 全量测试通过；
浏览器生产构建通过。
交互证据：固定 VS Code commit 源码注释与 <=0.5% pixel baseline、MutationObserver DOM
identity、主题/DPR/viewport 状态矩阵，以及真实 control-plane/Agent Host 的
create/send/cancel/approval/files/changes/layout restore 流程全部通过。
补充验收：Settings 单层导航覆盖 Common Settings、Workspaces、Templates、Credentials、
Models、Provisioners、Jobs、Builds；workspace picker 的创建 action 完成表单与真实 POST
请求，不依赖已有 workspace。
残余风险：Vite 仍提示主 bundle 超过 500 kB；不影响本轮功能与视觉验收，后续可按路由或
贡献点做动态分包。

## UI 阶段执行顺序与依赖

```text
R13 primitives/theme/fixture
 └─ R14 shell/titlebar/layout
     ├─ R15 catalog model/list
     ├─ R16 new session/composer
     │   └─ R17 active chat/interruption
     └─ R18 auxiliary/files/changes/panel
         └─ R19 responsive/a11y/motion
             └─ R20 parity gate + legacy deletion
```

- R15 与 R16 可在 R13、R14 完成后并行，但不能各自创建第二套 action/picker primitive。
- R17 必须复用 R16 的 input model、toolbar 和 attachment model，不能复制 composer。
- R18 必须消费 R14 Layout Service 的状态，不在 Files/Changes View 内直接改 shell class。
- R20 前允许短期保留旧 CSS 以便分区迁移，但同一区域切换到新实现时必须立即删除旧规则。
- 每个阶段都要先完成源码研究记录、组件 fixture 和状态矩阵，再接真实领域 Service。

## 每阶段记录模板

完成阶段时在对应章节后追加：

```text
完成日期：YYYY-MM-DD
变更范围：<files/modules>
删除项：<removed legacy APIs>
验证命令：<commands>
测试结果：<counts>
交互证据：<screenshots/playwright assertions>
残余风险：<none or explicit follow-up>
```
