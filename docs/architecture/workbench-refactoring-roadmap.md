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

截至 2026-07-27：

- [x] Widget 使用构造函数接收 `HTMLElement`，通过 DOM API 创建节点。
- [x] Widget 使用 `Event<T>`、`Emitter<T>` 和 `onDidXxx` 暴露事件。
- [x] View Container 和 View Descriptor 已有统一注册表。
- [x] 内建顶层 View 已通过 contribution 注册。
- [x] Inversify token 位于各自接口或类模块，不再集中维护 types map。
- [x] 服务使用 `@injectable()` 和显式 `@inject()` 构造注入。
- [ ] `Workbench` 仍持有 Session、Terminal、Changes、Files、Management 和布局状态。
- [ ] `WorkbenchViewContext` 仍是所有 View 共用的全局状态快照。
- [ ] `WorkbenchViewAction` 仍是所有 View 共用的中央 action union。
- [ ] `handleViewAction()` 仍是中央业务 dispatcher。
- [ ] 状态变化仍通过销毁全部 View 和 Shell 完成全量重绘。
- [ ] View descriptor factory 尚未由 Inversify 直接实例化具体 View。

基线规模仅用于判断趋势，不作为单独完成条件：

- `bootstrap/workbench.ts` 约 1860 行。
- `Workbench` 有约 56 个状态字段、74 个成员方法和 16 个构造参数。
- `WorkbenchViewContext` 有约 58 个字段。
- `WorkbenchViewAction` 有约 60 个 action variant。

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

- [ ] 开始阶段前，将 `main` 链接固定为当日 commit permalink，避免后续源码漂移。
- [ ] 至少阅读接口/registry、运行时 service 和一个真实 feature contribution，不能只读一个文件。
- [ ] 在代码评审中逐项回答上述五个问题。
- [ ] 若设计偏离 VS Code，记录 Zaw 的约束和偏离理由，不以“更简单”为唯一理由。
- [ ] 禁止逐行移植 VS Code；只借鉴职责、生命周期、依赖方向和注册模式。

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

- [ ] `workbench/browser/workbench.ts`：确认 Workbench 的 startup 和 Part 边界。
- [ ] `platform/registry/common/platform.ts`：确认 registry 只保存贡献描述。
- [ ] `platform/instantiation/common/{instantiation,descriptors,extensions}.ts`：确认
      descriptor 与运行时实例化的分工。

### 工作项

- [ ] 更新 `docs/architecture/workbench.md`，明确 Workbench、Part、View、
      Service、Contribution、Command 和 Context Key 的职责。
- [ ] 更新 `docs/architecture/implementation.md` 的最终 Workbench 目录。
- [ ] 定义 production import 规则：
  - `bootstrap` 可依赖 platform/workbench 注册与布局接口。
  - `contrib/<feature>` 可依赖 platform、workbench framework、provider port。
  - `services` 不依赖具体 View/Widget/Part。
  - `providers` 不依赖 View、Part 或 Workbench。
- [ ] 增加架构测试，禁止 `bootstrap/workbench.ts` import `contrib/**` 具体功能。
- [ ] 增加架构测试，禁止 View 直接 import HTTP/WebSocket/AHP provider。
- [ ] 增加架构测试，禁止 Service import DOM Widget 和具体 View。
- [ ] 为每个后续阶段建立可更新的规模断言或统计脚本。

### 完成条件

- [ ] 文档与自动化依赖检查一致。
- [ ] 新增一个 feature skeleton 不需要修改 Workbench。
- [ ] 违反依赖方向的测试能稳定失败。

## R1：Workbench 生命周期 Contribution

### 目标

建立独立于 View Registry 的通用 Workbench Contribution Registry，使功能按
生命周期由 DI 创建和销毁。

### VS Code 必读

- [ ] `workbench/common/contributions.ts`：重点阅读 `WorkbenchPhase`、
      `registerWorkbenchContribution2()`、按 phase 实例化、异常隔离和 timing。
- [ ] `workbench/services/lifecycle/common/lifecycle.ts`：重点阅读 `phase`、`when()`、
      `onWillShutdown` 和 `onDidShutdown`。
- [ ] `workbench/browser/workbench.ts`：确认 registry 在何时启动和 phase 在何时推进。

### 工作项

- [ ] 定义 `IWorkbenchContribution`，Contribution 必须可选实现 `IDisposable`。
- [ ] 定义生命周期阶段：`Starting`、`Ready`、`Restored`、`Eventually`。
- [ ] 实现 `IWorkbenchContributionsRegistry`：
  - 唯一 contribution ID。
  - 按 lifecycle phase 注册。
  - 支持 lazy contribution。
  - 支持阶段已到达后的即时注册。
  - 统一记录实例和 disposal。
  - 单个 contribution 失败不能阻止其余 contribution 启动。
- [ ] 实现 `ILifecycleService` 和阶段推进事件。
- [ ] 由 Inversify 创建 contribution，禁止 registry 手工拼构造参数。
- [ ] 将 builtin contribution 注册从 `container.ts` 的手工函数调用迁出。
- [ ] 将 Session Catalog polling 迁入 Session contribution。
- [ ] 将 AHP attachment listeners 迁入 Session/Attachment contribution。
- [ ] 将 theme 初始化迁入 Theme contribution。
- [ ] 将全局快捷键和窗口监听拆成基础 Workbench contributions。
- [ ] Workbench shutdown 时按逆序 dispose contributions。

### 测试

- [ ] 各生命周期阶段只实例化一次。
- [ ] lazy contribution 首次请求时实例化。
- [ ] contribution 构造失败被隔离并记录。
- [ ] disposal 顺序与注册生命周期正确。
- [ ] fake clock 验证 Eventually contribution 不阻塞首屏。

### 完成条件

- [ ] `Workbench.start()` 不包含 Catalog、AHP、Theme 或业务 feature 初始化。
- [ ] `container.ts` 不直接调用各 feature 的 `registerBuiltinXxx()`。
- [ ] Workbench 只启动 lifecycle 和 contribution registry。

## R2：Command 与 Action 基础设施

### 目标

建立统一行为入口，替代 View event 到中央 `WorkbenchViewAction` 的闭合 union。

### VS Code 必读

- [ ] `platform/commands/common/commands.ts`：Command Registry 与 Service 的边界。
- [ ] `platform/actions/common/actions.ts`：`Action2`、Menu 和 precondition 的组合。
- [ ] `workbench/services/views/browser/viewsService.ts`：View open/focus action 如何复用
      Command、Context Key 和 ServicesAccessor。

### 工作项

- [ ] 定义 `ICommandRegistry`：command ID、handler、metadata、disposable registration。
- [ ] 定义 `ICommandService.executeCommand(id, ...args)`。
- [ ] Command handler 通过受控的 DI accessor 获取 Service。
- [ ] 定义 `Action` descriptor：title、icon、command、order、precondition。
- [ ] 建立 menu registry，至少覆盖 titlebar、view title、context menu。
- [ ] 建立 keybinding registry，避免快捷键逻辑留在 Workbench。
- [ ] 为命令参数提供运行时 validation，不信任任意 contribution 输入。
- [ ] 按 feature 建立命令文件：
  - `sessions/session.commands.ts`
  - `terminal/terminal.commands.ts`
  - `changes/changes.commands.ts`
  - `files/files.commands.ts`
  - `management/management.commands.ts`
- [ ] View Button/Select 事件改为执行 command 或调用窄 Service API。
- [ ] 每迁移一个 command，删除对应 `WorkbenchViewAction` variant 和
      `handleViewAction()` 分支。

### 测试

- [ ] 重复 command ID 被拒绝。
- [ ] command 参数 validation 失败不调用 handler。
- [ ] command registration dispose 后不可执行。
- [ ] menu 和 keybinding 指向不存在 command 时测试失败。
- [ ] command handler 可用 mock services 独立测试。

### 完成条件

- [ ] 任一功能行为都能从 command palette、menu 或 View 复用同一 command。
- [ ] 新增 command 不需要修改 Workbench。
- [ ] Workbench 不再解析 feature action kind。

## R3：Context Key 与可见性模型

### 目标

用可观察、可组合的 Context Key 表达 enablement 和 visibility，替代把全部状态
传给 view descriptor 的 `when(context)`。

### VS Code 必读

- [ ] `platform/contextkey/common/contextkey.ts`：表达式、scoped key 和事件聚合。
- [ ] `workbench/services/views/browser/viewDescriptorService.ts`：active、visible、
      movable 和 default-location keys 的所有权。
- [ ] `workbench/contrib/files/browser/explorerViewlet.ts`：真实 feature 如何声明 `when`。

### 工作项

- [ ] 定义 `IContextKeyService`、`IContextKey<T>` 和 scoped context。
- [ ] 支持 `has`、`equals`、`not`、`and`、`or` 表达式。
- [ ] Action、Menu、Keybinding 和 View descriptor 共用 Context Key expression。
- [ ] 建立核心 key：
  - active workspace/session。
  - workspace online。
  - terminal open/active。
  - panel/sidebar visibility。
  - management open/dirty。
  - mobile/desktop viewport。
- [ ] 各领域 Service 在状态变化时更新自己拥有的 context key。
- [ ] View host 订阅相关 key，局部创建、隐藏或销毁目标 View。
- [ ] 删除 descriptor 的 `(context) => boolean` 全局 predicate。

### 测试

- [ ] 表达式组合和 scoped override。
- [ ] key 真实变化时才触发事件。
- [ ] View visibility 与 command precondition 使用同一表达式结果。
- [ ] context scope dispose 后不泄漏 key。

### 完成条件

- [ ] View descriptor 不读取业务状态快照。
- [ ] Menu、Command、Keybinding 和 View visibility 不重复实现条件判断。

## R4：稳定 Part 与局部 View 生命周期

### 目标

Workbench 启动时创建一次稳定 Part，后续状态变化只更新受影响 View 的 DOM。

### VS Code 必读

- [ ] `workbench/browser/workbench.ts`：`renderWorkbench()` 如何只创建一次 Part DOM。
- [ ] `workbench/browser/{layout,part}.ts`：Part、布局和持久化职责。
- [ ] `workbench/browser/parts/views/{viewPane,viewPaneContainer}.ts`：View create、
      visibility、layout 和 disposal。
- [ ] `workbench/services/views/browser/viewsService.ts`：descriptor 到运行时 View 的创建。

### 工作项

- [ ] 定义稳定 Part ID 和 `IWorkbenchLayoutService`。
- [ ] Workbench 启动时只创建一次 Titlebar、Sidebar、Primary、Auxiliary、Panel、
      Overlay Part root。
- [ ] Part 拥有尺寸、可见性、布局和 resize handle，不拥有领域状态。
- [ ] `WorkbenchViewHost` 从“每次 render 全部”改为长期运行的 host：
  - 监听 container/view registry 变化。
  - 按 descriptor 增量创建和销毁 View。
  - 保持未受影响 View 的 DOM identity。
  - 支持 visibility、focus 和 active view。
- [ ] View descriptor 使用 class/DI descriptor，而不是闭包 factory 捕获全局 context。
- [ ] Layout Service 持久化 panel visibility、width、height 和移动端布局。
- [ ] 将 floating drag/resize、focus trap 和 modal inert 放入 Overlay/Layout 服务。
- [ ] 删除 `WorkbenchShell` 每次 `replaceChildren()` 的更新路径。
- [ ] 删除 `Workbench.updateWorkbench()` 对所有 View 的全量 dispose。

### 测试

- [ ] 更新一个 Session draft 不改变 textarea DOM identity 和 focus。
- [ ] 更新 Terminal 不销毁 Session View。
- [ ] 注册/注销一个 View 只影响对应 container。
- [ ] Part 尺寸变化不重建 View。
- [ ] View dispose 恰好执行一次，无 listener 泄漏。

### 完成条件

- [ ] Workbench root 和所有 Part root 在运行期保持稳定。
- [ ] 不存在全量 render 方法。
- [ ] 任意状态变更有明确的局部更新所有者。

## R5：Typed Provider 边界

### 目标

把 HTTP endpoint、JSON body 和 AHP transport 完全封装在 Provider/Adapter，
为领域 Service 提供 typed port。

### VS Code 必读

- [ ] 选择一个与 Zaw provider 最接近的 VS Code service/provider 对，记录接口层和
      browser/native 实现层的依赖方向。
- [ ] 阅读 `workbench/contrib/terminal/browser/terminalService.ts`，确认 feature service
      如何隔离 UI 与底层 terminal backend。

### 工作项

- [ ] 扩展 `IManagementProvider`，提供 Template、Credential、Model、Runtime 的
      typed 方法。
- [ ] 删除 Workbench 和 View 对 `request<T>(path, init)` 的使用。
- [ ] 为每个 HTTP provider 添加 path、method、body 和错误映射测试。
- [ ] 定义 AHP typed ports：Session、Chat、Terminal、Changeset、Resource。
- [ ] AHP action contribution 只做协议 action 到领域事件的适配。
- [ ] Provider error 映射为稳定 application error，不把原始 response 泄漏到 View。
- [ ] 对 cancellation、stale response 和 reconnect 建立一致策略。

### 完成条件

- [ ] Workbench、Service 和 View 中不存在 URL 字符串或 `RequestInit`。
- [ ] View 和 Workbench 不 import AHP frame/action utility。
- [ ] Provider contract 可用 fake adapter 完整测试。

## R6：Management 功能垂直迁移

### 目标

让 Management 成为第一个完整遵循最终架构的 feature，用它验证 Service、
Contribution、Command、Context Key 和局部 View 更新闭环。

### VS Code 必读

- [ ] `workbench/contrib/files/browser/explorerViewlet.ts`：container、dynamic views、
      context keys 和 contribution 的组合。
- [ ] `workbench/contrib/files/browser/files.contribution.ts`：feature 级注册入口。
- [ ] R1–R4 的源码研究记录已完成，禁止跳过框架阶段直接迁移 Management。

### 工作项

- [ ] 定义 `IManagementService`，拥有 templates、credentials、models、runtime、
      editing、pending、dirty 和 sheet 状态。
- [ ] Service 提供只读查询和 `onDidChange` 细分事件。
- [ ] CRUD、reload、build command 由 Service 调用 typed providers。
- [ ] Template/Credential/Runtime Views 直接注入 Management Service。
- [ ] Management contribution 注册 view container、views、commands、actions 和 keys。
- [ ] Sheet contribution 根据 Management Service 状态显示，不读取全局 context。
- [ ] Notification 使用 `INotificationService`，不写 Workbench `toast`。
- [ ] 删除 Workbench 中 management fields、CRUD methods、form parsing、
      `managementActionHandlers` 和相关 view actions。

### 测试

- [ ] 初始加载、保存、删除、失败、重试和 stale response。
- [ ] dirty sheet close/continue/discard 状态机。
- [ ] secret 不进入持久化状态、日志和 View model。
- [ ] 单个 management 变化不重建 Session/Terminal View。

### 完成条件

- [ ] Management 功能不依赖 Workbench 私有状态或方法。
- [ ] 删除 `IManagementViewRegistry` 与顶层 View Registry 的重复职责；保留确有
      必要的 Management 子视图 registry 时，应只包含 descriptor metadata。

## R7：Workspace Resources 功能垂直迁移

### 目标

迁移 Files、Changes、Changeset、Preview 和 detail tabs 的全部状态与行为。

### VS Code 必读

- [ ] `workbench/contrib/files/browser/explorerViewlet.ts` 和 Explorer views：确认
      descriptor、container、model/service 与 View 的边界。
- [ ] `workbench/common/views.ts`：确认动态 register/deregister/move 的事件语义。

### 工作项

- [ ] 定义 `IWorkspaceResourceService`。
- [ ] Service 按 workspace/session identity 管理 files、changes、changeset resource。
- [ ] 定义 `IDetailViewService` 管理 tabs、active tab 和 preview 生命周期。
- [ ] 实现 read/open directory/open file/stage/revert/review typed operations。
- [ ] stale workspace response 不得覆盖当前 workspace 状态。
- [ ] Changes 和 Files 各自注册 View、Commands、Actions 和 Context Keys。
- [ ] AHP changeset contribution 写入 Workspace Resource Service。
- [ ] 删除 Workbench 中 changes/files/detailTabs/pendingRevert 状态和方法。
- [ ] 评估并删除 `DetailTabRendererRegistry`：静态 tab 应改为注册 View；动态 preview
      应由 Detail View Service 管理 descriptor/input。

### 完成条件

- [ ] Secondary Sidebar 只依赖 View Registry 和对应领域 Service。
- [ ] Files/Changes 操作不经过 Workbench dispatcher。
- [ ] 跨 workspace 切换和并发加载有确定测试。

## R8：Terminal 功能垂直迁移

### 目标

让 Terminal 状态、远程资源和 UI lifecycle 完全归 Terminal feature 所有。

### VS Code 必读

- [ ] `workbench/contrib/terminal/browser/terminal.contribution.ts`：Terminal 注册入口。
- [ ] `workbench/contrib/terminal/browser/terminalService.ts`：实例、active terminal 和事件。
- [ ] 对比 View 生命周期与 terminal process 生命周期，记录为何隐藏 Panel 不能销毁
      远程资源。

### 工作项

- [ ] 定义 `ITerminalService`：terminal collection、active terminal、create、dispose、
      attach、input、resize。
- [ ] 定义 `ITerminalGroupService`：active/open/collapsed 和 View placement。
- [ ] Terminal output 使用增量事件，不复制完整输出触发全局重绘。
- [ ] Terminal contribution 注册 panel container/view、commands、actions 和 keys。
- [ ] workspace attach 后由 Terminal contribution/service reattach terminals。
- [ ] 关闭 Panel 不销毁远程 terminal；dispose command 才销毁资源。
- [ ] resize observer 归 Terminal View 或 Layout Service，不在 Workbench。
- [ ] 删除 Workbench 中 terminals、activeTerminal、terminalOpen、collapsed、height
      状态和所有 terminal 方法。

### 测试

- [ ] create/select/input/resize/dispose/reattach。
- [ ] output 高频更新不重建 Session View。
- [ ] active terminal 被删除后的 fallback。
- [ ] workspace 切换时旧 terminal event 被隔离。

### 完成条件

- [ ] Terminal feature 可在测试容器中独立启动。
- [ ] Workbench 不知道 AHP terminal resource。

## R9：Session、Catalog 与 Attachment 功能垂直迁移

### 目标

迁移耦合最高的 Session Catalog、Workspace Attachment、Chat 和 AHP projection。

### VS Code 必读

- [ ] 复读 `workbench/common/contributions.ts` 的 lazy contribution，决定 Catalog 和
      Attachment 分别在哪个 phase 启动。
- [ ] 选择 VS Code 中一个 remote/session 类 service，记录 connection generation、
      cancellation 和 stale event 的处理方式；若不适用，明确记录差异。

### 工作项

- [ ] `ISessionCatalogService` 拥有 polling、sessions、titles 和 host availability。
- [ ] `IActiveSessionService` 增加 `onDidChange`，复合 identity 是唯一选择状态。
- [ ] `IWorkspaceAttachmentService` 拥有 connection state、generation、reconnect 和
      stale connection 隔离。
- [ ] `IChatSessionService` 拥有 composition、draft、attachments、active turn 和消息。
- [ ] 定义 `ISessionService` 编排 create/send/cancel/confirm tool call。
- [ ] 定义 `IAHPProjectionService`，将协议贡献结果写入对应领域 Service。
- [ ] Session contribution 注册 catalog view、session view、commands、actions 和 keys。
- [ ] Session View 直接注入 Session/Chat/Attachment services。
- [ ] Session event renderer 只负责消息内容 renderer；消息 collection 属于 Chat Service。
- [ ] 删除 Workbench 中 sessions、titles、messages、connectionState、new session draft、
      models、catalog timer 和相关方法。
- [ ] 删除 Workbench 对 AHP action registry 和 action utils 的依赖。

### 测试

- [ ] Catalog polling 使用 fake clock；后台更新不改变 active session。
- [ ] 同 workspace 切换复用 attachment，跨 workspace 切换关闭旧 attachment。
- [ ] reconnect generation 防止旧连接覆盖新连接。
- [ ] create/send/cancel/approval/attachment 的成功与失败路径。
- [ ] snapshot + delta + turn complete/error 的 projection 顺序。

### 完成条件

- [ ] Workbench 不知道 Workspace、Session、Chat、AHP 或 Agent Host。
- [ ] Session feature 可由 contribution 独立注册和销毁。

## R10：View Descriptor DI 化与全局 Context 删除

### 目标

让每个 View 由 DI 创建并消费局部 Service，彻底删除全局 View Context。

### VS Code 必读

- [ ] `workbench/common/views.ts`：`IViewDescriptor.ctorDescriptor` 和 registry。
- [ ] `workbench/services/views/browser/viewDescriptorService.ts`：descriptor model。
- [ ] `workbench/services/views/browser/viewsService.ts`：通过 instantiation service 创建
      container 和 View。
- [ ] `platform/instantiation/common/descriptors.ts`：static arguments 与注入参数边界。

### 工作项

- [ ] `WorkbenchViewDescriptor` 改为 constructor descriptor + static arguments。
- [ ] View Host 使用 Inversify 创建 View。
- [ ] 每个 View 声明自己的注入依赖和局部 options。
- [ ] 动态实例数据使用 scoped child container、input/model 或明确 factory service，
      不重新引入全局 context。
- [ ] View 自己订阅 Service events，并仅更新自己的 DOM。
- [ ] View Host 管理 focus、visibility、activation 和 disposal。
- [ ] 删除 `services/workbench-view-context.ts`。
- [ ] 删除 `WorkbenchViewContext`、`WorkbenchViewAction` 和 `emitAction`。
- [ ] 删除闭包式 `renderX(root, context)` builtin factories。
- [ ] 将 builtin contribution 拆到各 feature 目录，不保留一个导入所有具体 View 的
      `views/workbench/workbench.contribution.ts`。

### 完成条件

- [ ] 顶层不存在全局 UI state DTO。
- [ ] 一个 View 的依赖变化不要求修改其他 View descriptor 类型。
- [ ] 新增 View 只需注册 descriptor 并实现注入依赖。

## R11：Workbench 收缩与旧架构删除

### 目标

把 Workbench 收缩为真正的基础工作台，并删除所有过渡架构。

### VS Code 必读

- [ ] 完整复读 `workbench/browser/workbench.ts`，逐个对照 Zaw Workbench 成员。
- [ ] 对每个无法映射到 startup、Part、layout、restore、shutdown 的成员，标注其领域
      Service owner 并迁出。

### Workbench 最终职责

- [ ] 构造和持有稳定 root。
- [ ] 初始化服务容器与基础 platform。
- [ ] 启动 lifecycle 和 contributions。
- [ ] 创建稳定 Parts 和 layout grid。
- [ ] 注册全局错误处理。
- [ ] restore、layout、shutdown 和 dispose。

### 删除项

- [ ] 删除所有 feature state fields。
- [ ] 删除所有 feature service 构造参数。
- [ ] 删除所有 CRUD、Session、Terminal、Changes、Files 和 AHP methods。
- [ ] 删除 `handleViewAction()`。
- [ ] 删除 `updateWorkbench()`。
- [ ] 删除 `WorkbenchShell` 的全量节点输入 API；保留时只能是稳定 layout object。
- [ ] 删除未使用的局部 contribution registries 和兼容 adapter。
- [ ] 删除 Workbench 对 `window.localStorage`、HTTP、AHP 和具体 View 的访问。
- [ ] 删除为旧架构保留的 tests 和 fixtures，替换为 feature/service tests。

### 完成条件

- [ ] `workbench.ts` 目标 150–300 行；超过时必须逐项说明基础职责。
- [ ] Workbench 直接依赖不超过 8 个基础 framework services。
- [ ] Workbench imports 中不存在 `contrib/**`、provider 或领域 model。
- [ ] Workbench 测试只验证 startup、layout、restore、shutdown 和 contribution lifecycle。

## R12：扩展性、性能与交互总验收

### 目标

证明最终架构不仅通过类型检查，而且具备真实扩展性、局部更新和完整交互质量。

### VS Code 复核

- [ ] 使用阶段记录中的固定 commit permalink 复核所有参考结论。
- [ ] 检查最终代码是否采用了职责和生命周期，而非只复制 VS Code 命名。
- [ ] 将 Zaw 最终结构与 `workbench.ts`、`contributions.ts`、`views.ts` 和一个真实
      feature contribution 做最后一次依赖方向对照。

### 自动化门禁

- [ ] `pnpm --filter @zaw/ui typecheck`。
- [ ] `pnpm --filter @zaw/ui test`。
- [ ] `pnpm --filter @zaw/workbench typecheck`。
- [ ] `pnpm --filter @zaw/workbench test`。
- [ ] `pnpm format:check`。
- [ ] 架构依赖测试通过。
- [ ] 无 `innerHTML`、HTML template string 或 `data-action` 全局事件总线。
- [ ] 无 `WorkbenchViewContext`、`WorkbenchViewAction`、`handleViewAction`、
      `updateWorkbench`。
- [ ] Workbench 不 import 具体 feature。

### 扩展性验收

- [ ] 测试贡献一个示例 View Container、View、Command、Menu 和 Context Key，
      不修改 Workbench 源码即可显示和执行。
- [ ] 动态注销示例 contribution 后，View、command、menu 和 listeners 全部释放。
- [ ] 重复 contribution/view/command ID 有明确错误。
- [ ] contribution 启动失败不会破坏其他功能。

### DOM 与性能验收

- [ ] 输入 draft 时 textarea identity、selection 和 focus 保持。
- [ ] Terminal 高频输出不触发 Workbench root mutation。
- [ ] Session streaming 只更新对应 message node。
- [ ] 打开 Management 不销毁 Session 和 Terminal View。
- [ ] Resize 只更新 layout，不重建 Part/View。
- [ ] 使用 `MutationObserver` 测试关键 DOM identity。
- [ ] 使用性能测试记录首屏 contribution 阶段耗时和局部更新开销。

### 交互验收

- [ ] Desktop、Tablet、Mobile 布局。
- [ ] Dark、Light、High Contrast、System 主题。
- [ ] Workspace/Session 切换、offline/reconnect。
- [ ] Session create/send/cancel/tool approval。
- [ ] Terminal create/input/resize/reattach/dispose。
- [ ] Changes/Files/open/stage/revert/review。
- [ ] Management CRUD、dirty confirmation、floating focus trap。
- [ ] Dropdown 外部关闭、互斥和 Esc 层级。
- [ ] Playwright 截图和无重叠、无横向溢出断言。

### 最终完成条件

- [ ] 新功能可以独立贡献 Service、View、Command 和 Context Key。
- [ ] 所有领域状态都有唯一 Service owner。
- [ ] 所有行为都有 command 或窄 Service API owner。
- [ ] Workbench 不再是业务依赖中心。
- [ ] 不存在旧架构 compatibility path。
- [ ] 文档、代码、测试和截图反映同一最终架构。

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
