# Plan 评审设计（暂缓实现）

> 状态：设计保留，暂不实现。
>
> 调研日期：2026-07-29。恢复实施前必须重新检查 AHP 官方协议和公开提案，
> 不得直接按本文的候选私有扩展开始编码。

## 结论

截至调研日期，Agent Host Protocol 没有公开的 Plan Mode、Plan Review、
`ChatInputRequest.planReview` 或通用 Resource Review 协议类型，也没有公开的
相关 Issue/PR 路线图。

AHP 近期已经提供或正在讨论的相邻能力包括：

- [`ChatInputRequest`](https://microsoft.github.io/agent-host-protocol/reference/chat.html#chatinputrequest)
  可以表达阻塞式问题、答案和完成结果，但目前只有 `id`、`message`、`url`、
  `questions`、`answers`，没有 `_meta` 或计划评审字段。
- [Annotations Channel](https://microsoft.github.io/agent-host-protocol/reference/annotations.html)
  已支持以 `resource + turnId + TextRange` 为锚点的批注及批注回复；对应能力由
  [PR #195](https://github.com/microsoft/agent-host-protocol/pull/195) 引入。
- Input Request 已成为可持久化的响应流部分，并能在完成后保留于 Turn transcript；
  见 [PR #325](https://github.com/microsoft/agent-host-protocol/pull/325) 和
  [PR #338](https://github.com/microsoft/agent-host-protocol/pull/338)。
- [Canvas PR #298](https://github.com/microsoft/agent-host-protocol/pull/298)
  正在提议通用的客户端渲染面，并使用 `contentUri + resourceRead` 加载内容；它可
  能成为未来文档评审 UI 的基础，但当前仍是开放 PR，且没有定义计划审批语义。
- Multi-chat 提案只在产品示例中提到 plan mode/plan approval，没有增加对应协议
  类型；见
  [multi-chat proposal](https://github.com/microsoft/agent-host-protocol/blob/7144635c3b3eae70348b012f1fc4e674775ea459/docs/proposals/multi-chat.md)。

因此 Zaw 暂时不新增 Plan Review 的运行时实现，不修改 vendored AHP schema，也不
引入尚未稳定的私有 wire contract。Composer 中的 Plan 入口继续隐藏。

## 产品目标

未来恢复实现时，计划评审应满足：

1. Agent 在 Plan 模式完成计划后暂停执行。
2. Workbench 右侧 Auxiliary Bar 自动打开 Plan 视图。
3. Workbench 从产生计划的 Agent Host 读取 `file://.../plan.md`。
4. 用户可以选择一段原始计划文本并添加范围批注。
5. 用户可以批准计划，或将总体意见和范围批注提交给 Agent 重新规划。
6. Plan 视图关闭后可通过命令重新打开，未提交批注不会因关闭视图而丢失。
7. 不了解增强字段的 AHP 客户端仍能通过普通问题完成批准或拒绝。

## 候选协议映射

如果恢复实施时 AHP 仍没有正式能力，可以在合理范围内使用 Zaw 私有对象。候选
wire shape 是扩展 `ChatInputRequest`，而不是修改官方 schema：

```ts
type ChatInputRequestWithPlanReview = ChatInputRequest & {
  planReview?: {
    version: 1;
    resource: string;
    title?: string;
    contentType?: "text/markdown" | "text/plain";
    annotations?: string;
    capabilities?: {
      comment?: boolean;
      edit?: boolean;
    };
  };
};
```

示例：

```json
{
  "id": "review-plan-1",
  "message": "Review the implementation plan",
  "questions": [
    {
      "id": "decision",
      "kind": "single-select",
      "options": [
        { "id": "approve", "label": "Approve" },
        { "id": "revise", "label": "Request changes" }
      ]
    }
  ],
  "planReview": {
    "version": 1,
    "resource": "file:///tmp/agent-session/plan.md",
    "contentType": "text/markdown",
    "annotations": "ahp-session:/session-id/annotations",
    "capabilities": { "comment": true, "edit": false }
  }
}
```

私有对象只描述呈现和关联信息：

- 计划正文不进入 action 或 snapshot，通过标准 `resourceRead` 按需读取。
- 决策仍使用标准 `questions` / `answers`。
- 完成仍使用标准 `chat/inputCompleted`。
- 范围批注优先使用标准 Annotations Channel；若第一版只在客户端暂存，提交时
  必须转换为带资源、行列和引用文本的普通反馈答案。
- 私有对象必须有版本号；未知版本按普通 Input Request 降级。
- 不在对象中存储连接 ID。Zaw 以当前 `workspaceID` 找到对应 AHP peer，确保远端
  `file:` URI不会被当作 Browser/Server 本地路径读取。

## 资源读取候选策略

计划文件可能位于 Workspace、Agent SDK 会话目录或临时目录。恢复实施时可以放宽
Agent Host 的 `resourceRead`：

- 接受 Agent Host 环境中的绝对 `file:` URI，不限定在 Workspace 根目录。
- 只读取普通文件，拒绝目录、设备、FIFO 和 Socket。
- 默认单次上限为 16 MiB，并允许通过配置调整。
- UTF-8 返回文本，其他内容按 AHP `base64` encoding 返回。
- 所有读取仍发生在收到请求的 Agent Host 内；Server 和 Browser 不直接打开远端
  `file:` URI。

该策略只是一项候选设计。当前 `resourceRead` 的 Workspace 边界和 1 MiB 限制保持
不变，直到 Plan Review 正式恢复实施。

## 范围批注候选交互

Plan 视图显示只读 Markdown 源文本。用户选择非空文本后可以新增批注，批注锚点
至少包含：

```ts
type PlanComment = {
  id: string;
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
  quote: string;
  comment: string;
};
```

- `offset` 用于精确定位，行列用于显示和反馈序列化。
- `quote` 用于检测计划被重写后的锚点失效，不允许静默漂移到其他文本。
- 批注支持编辑、删除、点击定位和范围高亮。
- 新的计划评审 `request.id` 表示新版本；旧批注保留为历史，但不得自动套用到新
  计划。
- 提交修改意见时，把批注格式化为包含文件名、行列、引用和评论的 Markdown；
  批准计划时不附带反馈。

## 恢复实施条件

满足以下任一条件后重新评估，不自动开工：

1. AHP 合入正式的 Plan Review 或通用 Resource Review 类型。
2. Canvas Channel 合入并明确适合承载阻塞式计划评审。
3. Zaw 的产品需求明确要求先于上游落地私有扩展，并接受兼容成本。

重新评估时必须确认：

- AHP `main`、最新 release 和公开 Issues/PR 的现状。
- 官方 Go Client 是否保留未知 `ChatInputRequest` 字段；若不保留，私有包装类型的
  序列化是否能端到端通过 reducer、snapshot、reconnect 和 transcript。
- Annotations Channel 对临时计划文件及 Turn 版本锚点的语义是否足够。
- Canvas 是否已经提供更合适的标准承载方式。

## 暂缓范围

本设计当前不授权以下实现：

- 不恢复 Composer 的 Plan 模式选项。
- 不增加 `ChatInputRequest.planReview` 私有字段。
- 不增加 Plan Review Service、范围批注组件或提交逻辑。
- 不放宽 Agent Host `resourceRead` 权限或大小限制。
- 不修改 AHP schema、vendored 协议或官方 SDK 类型。
