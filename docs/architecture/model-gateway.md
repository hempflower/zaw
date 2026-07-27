# Server 模型网关

## 边界

模型由 Server 统一提供。用户创建 Provider 时填写 `apiBase` 与 `apiKey`，再为
Provider 创建逻辑 Model。Workspace 可以选择一个 Model；未选择时使用组织
默认 Model。

```text
Workbench / Agent Host
          │
          │ Zaw neutral Generate API
          ▼
    LLM use case
          │
          ├─ OpenAI Responses Adapter
          ├─ Anthropic Messages Adapter
          └─ DeepSeek Chat Adapter
                 │
                 ▼
          user-configured apiBase
```

- Gorm 只保存 Provider 类型、API base、Secret reference、Model 名称、上游名称
  和能力声明。
- API key 只保存在 Secret Store，不进入数据库、Terraform State、Agent Host、
  Workbench 响应或日志。
- Workspace 固定注册凭证可访问本 Workspace 的 Model profile 和推理 API；不能
  指定其他 Workspace，也不能取得 Provider 配置或 Secret。
- Provider Adapter 必须解析中立请求并重新构造厂商请求，再把厂商响应解析为
  中立事件；禁止请求体或响应体透传。

## HTTP API

管理 API：

```text
GET|POST     /api/v1/model-providers
PATCH|DELETE /api/v1/model-providers/{id}
GET|POST     /api/v1/models
PATCH|DELETE /api/v1/models/{id}
```

Agent Host 与模型调用 API：

```text
GET  /api/v1/agent-hosts/{workspaceId}/model
GET  /api/v1/llm/models
POST /api/v1/llm/generate
```

GitHub Copilot SDK 使用受限的 Responses wire adapter：

```text
POST /api/v1/llm/openai/responses
```

这个 endpoint 不是上游 OpenAI proxy。它把 Responses 请求转换为同一个
`GenerateRequest`，调用相同 use case，再把中立事件转换回 Responses event。
`/api/v1/llm/openai/v1/responses` 作为显式兼容别名保留；Copilot SDK 会在所给
base URL 后追加 `/responses`。

## 中立请求

`GenerateRequest` 不采用任一厂商的 wire schema：

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "分析这张图" },
        {
          "type": "image",
          "source": { "url": "https://example/image.png", "detail": "high" }
        }
      ]
    }
  ],
  "tools": [
    {
      "name": "read_file",
      "description": "读取工作区文件",
      "inputSchema": { "type": "object", "properties": {} },
      "strict": true
    }
  ],
  "toolChoice": { "mode": "auto" },
  "reasoning": {
    "effort": "high",
    "summary": "summarized"
  },
  "responseFormat": {
    "type": "json_schema",
    "name": "result",
    "schema": { "type": "object" },
    "strict": true
  },
  "parallelTools": true,
  "stream": true
}
```

内容类型为 `text`、`image`、`audio`、`file` 和用于多轮连续性的
`reasoning`。图片、音频和文件可使用 URL 或 base64 data，并显式携带 media
type。工具调用使用中立的 `ToolCall { id, name, arguments }`；工具结果由
`role=tool` 与 `toolCallId` 关联。

每个 Model 保存能力声明：文本、图片、音频、文件、推理、工具、结构化输出、
流式响应、可用 reasoning effort 和默认 effort。Use case 在调用厂商前验证
消息、schema、采样范围和能力；不支持时返回明确的 400，不静默删除字段。
`parallelTools` 是中立语义，Provider Adapter 只能显式映射受支持的厂商字段。
Copilot CLI 自动发送的 `include`、`store` 和 `prompt_cache_key` 只在 Responses
兼容入口被识别并丢弃，不进入中立协议，也不会到达上游 Provider。

## 中立流式事件

`stream=true` 使用 SSE。事件类型固定为：

```text
response.created
output.added
output.text.delta
output.reasoning.delta
output.tool_call.arguments.delta
response.completed
error
```

`response.completed` 包含聚合后的 `GenerateResponse`，其中 `output` 可同时包含
文本、推理摘要、拒答和工具调用；`usage` 统一为 input、cached input、output、
reasoning 与 total token。非流式调用消费同一内部事件流并返回最后的
`GenerateResponse`，避免两套语义漂移。

Responses 边缘适配器会为 delta 合成完整的 `output_item.added`、
`content_part.added` 和递增 `sequence_number` 生命周期，再发送 delta 与
`response.completed`。因此 Copilot SDK 不依赖不完整流的宽松解析行为。

## Provider 映射

- OpenAI 使用 Responses API，映射文字、图片、音频、文件、function tool、
  reasoning、structured output 和 Responses SSE。OpenAI 官方 Responses 文档
  定义了这些输入与细粒度流事件：
  [Responses streaming reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta)。
- Anthropic 使用 Messages API 的 content block；`thinking` 与 signature 必须
  原样保留以支持下一轮，工具用 `tool_use/tool_result`，图片与文件显式转换。
  当前模型使用 adaptive thinking 和 `output_config.effort`。流解析覆盖 text、
  thinking、signature 与 tool input JSON delta：
  [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、
  [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)。
- DeepSeek 使用 Chat Completions，但只由 Adapter 构造和解析。推理映射
  `thinking/reasoning_effort/reasoning_content`，工具和 JSON output 显式映射，
  SSE 转换为相同中立事件：
  [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion)、
  [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode)。

## Copilot SDK

首个 Agent Adapter 固定使用官方 Go module
`github.com/github/copilot-sdk/go`。Session 配置为 BYOK `type=openai`、
`wireApi=responses`，base URL 指向 Server 的 Responses adapter，Bearer token
使用 Workspace 注册凭证。GitHub 官方说明 Responses wire 支持 reasoning，且
BYOK 可使用静态 bearer token：
[Copilot SDK BYOK](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/auth/byok)。

Agent Host 不知道实际 Provider 类型、API base 或 API key；切换 Workspace
Model 只改变 Server 解析结果，不改变 Agent Host 的 Secret 边界。

本机真实兼容验收可通过以下命令运行；测试使用本地伪上游，不调用真实模型：

```text
ZAW_COPILOT_CLI_INTEGRATION=/path/to/copilot \
  go test ./internal/interfaces/http \
  -run TestCopilotSDKStreamsThroughServerModelGateway -count=1
```
