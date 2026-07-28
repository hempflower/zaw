// Package llm models Server-managed model providers and model selections.
package llm

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// ModelIdentifier is the stable, public model identity used by agent clients.
// Persistence IDs remain private to the management API.
func ModelIdentifier(provider Provider, model Model) string {
	return strings.TrimSpace(provider.ID) + "/" + strings.TrimSpace(model.UpstreamModel)
}

type ProviderKind string

const (
	ProviderOpenAI    ProviderKind = "openai"
	ProviderAnthropic ProviderKind = "anthropic"
	ProviderDeepSeek  ProviderKind = "deepseek"
)

var (
	ErrNotFound      = errors.New("LLM configuration not found")
	ErrConflict      = errors.New("LLM configuration conflict")
	ErrInvalid       = errors.New("invalid LLM configuration")
	ErrNoDefault     = errors.New("no default model is configured")
	ErrModelInUse    = errors.New("model is assigned to a workspace")
	ErrProviderInUse = errors.New("provider still has models")
)

type Provider struct {
	ID             string
	OrganizationID string
	Name           string
	Kind           ProviderKind
	APIBase        string
	SecretRef      string
	CreatedAt      string
	UpdatedAt      string
}

type Model struct {
	ID            string
	ProviderID    string
	Name          string
	UpstreamModel string
	IsDefault     bool
	Capabilities  Capabilities
	CreatedAt     string
	UpdatedAt     string
}

type Capabilities struct {
	TextInput              bool     `json:"textInput"`
	ContextWindow          int      `json:"contextWindow"`
	ImageInput             bool     `json:"imageInput"`
	AudioInput             bool     `json:"audioInput"`
	FileInput              bool     `json:"fileInput"`
	Reasoning              bool     `json:"reasoning"`
	Tools                  bool     `json:"tools"`
	StructuredOutput       bool     `json:"structuredOutput"`
	Streaming              bool     `json:"streaming"`
	ReasoningEfforts       []string `json:"reasoningEfforts,omitempty"`
	DefaultReasoningEffort string   `json:"defaultReasoningEffort,omitempty"`
}

type Selection struct {
	Provider Provider
	Model    Model
}

type Repository interface {
	ListProviders(context.Context, string) ([]Provider, error)
	GetProvider(context.Context, string, string) (Provider, error)
	CreateProvider(context.Context, Provider) error
	UpdateProvider(context.Context, Provider) error
	DeleteProvider(context.Context, string, string) error
	ListModels(context.Context, string) ([]Model, error)
	GetModel(context.Context, string, string) (Model, error)
	CreateModel(context.Context, string, Model) error
	UpdateModel(context.Context, string, Model) error
	DeleteModel(context.Context, string, string) error
	ResolveWorkspace(context.Context, string, string) (Selection, error)
}

type GenerateRequest struct {
	Model           string          `json:"model,omitempty"`
	Messages        []Message       `json:"messages"`
	Tools           []Tool          `json:"tools,omitempty"`
	ToolChoice      *ToolChoice     `json:"toolChoice,omitempty"`
	Reasoning       *Reasoning      `json:"reasoning,omitempty"`
	ResponseFormat  *ResponseFormat `json:"responseFormat,omitempty"`
	MaxOutputTokens int             `json:"maxOutputTokens,omitempty"`
	Temperature     *float64        `json:"temperature,omitempty"`
	TopP            *float64        `json:"topP,omitempty"`
	Stop            []string        `json:"stop,omitempty"`
	ParallelTools   *bool           `json:"parallelTools,omitempty"`
	Stream          bool            `json:"stream,omitempty"`
}

type Message struct {
	Role       string        `json:"role"`
	Content    []ContentPart `json:"content,omitempty"`
	ToolCalls  []ToolCall    `json:"toolCalls,omitempty"`
	ToolCallID string        `json:"toolCallId,omitempty"`
}

type ContentPart struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	Source    *ContentSource  `json:"source,omitempty"`
	Signature string          `json:"signature,omitempty"`
	Metadata  json.RawMessage `json:"metadata,omitempty"`
}

type ContentSource struct {
	URL       string `json:"url,omitempty"`
	Data      string `json:"data,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
	FileName  string `json:"fileName,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema"`
	Strict      bool            `json:"strict,omitempty"`
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type ToolChoice struct {
	Mode string `json:"mode"`
	Name string `json:"name,omitempty"`
}

type Reasoning struct {
	Effort  string `json:"effort,omitempty"`
	Summary string `json:"summary,omitempty"`
}

type ResponseFormat struct {
	Type        string          `json:"type"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Schema      json.RawMessage `json:"schema,omitempty"`
	Strict      bool            `json:"strict,omitempty"`
}

type GenerateResponse struct {
	ID           string       `json:"id"`
	Model        string       `json:"model"`
	Output       []OutputPart `json:"output"`
	FinishReason string       `json:"finishReason"`
	Usage        Usage        `json:"usage"`
}

type OutputPart struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ToolCall  *ToolCall       `json:"toolCall,omitempty"`
	Signature string          `json:"signature,omitempty"`
	Metadata  json.RawMessage `json:"metadata,omitempty"`
}

type Usage struct {
	InputTokens       int `json:"inputTokens"`
	CachedInputTokens int `json:"cachedInputTokens,omitempty"`
	OutputTokens      int `json:"outputTokens"`
	ReasoningTokens   int `json:"reasoningTokens,omitempty"`
	TotalTokens       int `json:"totalTokens"`
}

type Event struct {
	Type        string            `json:"type"`
	ResponseID  string            `json:"responseId,omitempty"`
	OutputIndex int               `json:"outputIndex,omitempty"`
	Delta       string            `json:"delta,omitempty"`
	Output      *OutputPart       `json:"output,omitempty"`
	Response    *GenerateResponse `json:"response,omitempty"`
	Error       *GenerationError  `json:"error,omitempty"`
}

type GenerationError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type Generation struct {
	Events <-chan Event
}

type Upstream interface {
	Generate(context.Context, Selection, string, GenerateRequest) (Generation, error)
}

func (kind ProviderKind) Valid() bool {
	switch kind {
	case ProviderOpenAI, ProviderAnthropic, ProviderDeepSeek:
		return true
	default:
		return false
	}
}
