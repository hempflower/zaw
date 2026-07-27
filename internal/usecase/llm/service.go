// Package llm implements Server-owned model configuration and routing.
package llm

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/zaw-dev/zaw/internal/domain"
	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

type Service struct {
	repository domainllm.Repository
	secrets    domain.SecretStore
	upstream   domainllm.Upstream
}

type ProviderInput struct {
	Name    string
	Kind    domainllm.ProviderKind
	APIBase string
	APIKey  string
}

type ModelInput struct {
	ProviderID    string
	Name          string
	UpstreamModel string
	IsDefault     bool
	Capabilities  domainllm.Capabilities
}

func New(
	repository domainllm.Repository,
	secrets domain.SecretStore,
	upstream domainllm.Upstream,
) *Service {
	return &Service{repository: repository, secrets: secrets, upstream: upstream}
}

func (s *Service) ListProviders(
	ctx context.Context,
	organizationID string,
) ([]domainllm.Provider, error) {
	return s.repository.ListProviders(ctx, organizationID)
}

func (s *Service) CreateProvider(
	ctx context.Context,
	organizationID string,
	input ProviderInput,
) (domainllm.Provider, error) {
	input, err := validateProvider(input, true)
	if err != nil {
		return domainllm.Provider{}, err
	}
	providerID := newID()
	provider := domainllm.Provider{
		ID: providerID, OrganizationID: organizationID,
		Name: input.Name, Kind: input.Kind, APIBase: input.APIBase,
		SecretRef: "zaw/model-providers/" + providerID,
	}
	if err := s.secrets.Put(
		ctx,
		provider.SecretRef,
		map[string]string{"apiKey": input.APIKey},
	); err != nil {
		return domainllm.Provider{}, fmt.Errorf("store provider API key: %w", err)
	}
	if err := s.repository.CreateProvider(ctx, provider); err != nil {
		_ = s.secrets.Delete(ctx, provider.SecretRef)
		return domainllm.Provider{}, err
	}
	return s.repository.GetProvider(ctx, organizationID, provider.ID)
}

func (s *Service) UpdateProvider(
	ctx context.Context,
	organizationID string,
	providerID string,
	input ProviderInput,
) (domainllm.Provider, error) {
	input, err := validateProvider(input, false)
	if err != nil {
		return domainllm.Provider{}, err
	}
	provider, err := s.repository.GetProvider(ctx, organizationID, providerID)
	if err != nil {
		return domainllm.Provider{}, err
	}
	provider.Name = input.Name
	provider.Kind = input.Kind
	provider.APIBase = input.APIBase
	if input.APIKey != "" {
		if err := s.secrets.Put(
			ctx,
			provider.SecretRef,
			map[string]string{"apiKey": input.APIKey},
		); err != nil {
			return domainllm.Provider{}, fmt.Errorf("update provider API key: %w", err)
		}
	}
	if err := s.repository.UpdateProvider(ctx, provider); err != nil {
		return domainllm.Provider{}, err
	}
	return s.repository.GetProvider(ctx, organizationID, provider.ID)
}

func (s *Service) DeleteProvider(
	ctx context.Context,
	organizationID string,
	providerID string,
) error {
	provider, err := s.repository.GetProvider(ctx, organizationID, providerID)
	if err != nil {
		return err
	}
	if err := s.repository.DeleteProvider(ctx, organizationID, providerID); err != nil {
		return err
	}
	if err := s.secrets.Delete(ctx, provider.SecretRef); err != nil {
		return fmt.Errorf("delete provider API key: %w", err)
	}
	return nil
}

func (s *Service) ListModels(
	ctx context.Context,
	organizationID string,
) ([]domainllm.Model, error) {
	return s.repository.ListModels(ctx, organizationID)
}

func (s *Service) GetModel(
	ctx context.Context,
	organizationID string,
	modelID string,
) (domainllm.Model, error) {
	return s.repository.GetModel(ctx, organizationID, modelID)
}

func (s *Service) CreateModel(
	ctx context.Context,
	organizationID string,
	input ModelInput,
) (domainllm.Model, error) {
	input, err := validateModel(input)
	if err != nil {
		return domainllm.Model{}, err
	}
	model := domainllm.Model{
		ID: newID(), ProviderID: input.ProviderID, Name: input.Name,
		UpstreamModel: input.UpstreamModel, IsDefault: input.IsDefault,
		Capabilities: input.Capabilities,
	}
	if err := s.repository.CreateModel(ctx, organizationID, model); err != nil {
		return domainllm.Model{}, err
	}
	return s.repository.GetModel(ctx, organizationID, model.ID)
}

func (s *Service) UpdateModel(
	ctx context.Context,
	organizationID string,
	modelID string,
	input ModelInput,
) (domainllm.Model, error) {
	input, err := validateModel(input)
	if err != nil {
		return domainllm.Model{}, err
	}
	model, err := s.repository.GetModel(ctx, organizationID, modelID)
	if err != nil {
		return domainllm.Model{}, err
	}
	if input.ProviderID != model.ProviderID {
		return domainllm.Model{}, fmt.Errorf(
			"%w: a model cannot move between providers",
			domainllm.ErrInvalid,
		)
	}
	model.Name = input.Name
	model.UpstreamModel = input.UpstreamModel
	model.IsDefault = input.IsDefault
	model.Capabilities = input.Capabilities
	if err := s.repository.UpdateModel(ctx, organizationID, model); err != nil {
		return domainllm.Model{}, err
	}
	return s.repository.GetModel(ctx, organizationID, model.ID)
}

func (s *Service) DeleteModel(
	ctx context.Context,
	organizationID string,
	modelID string,
) error {
	return s.repository.DeleteModel(ctx, organizationID, modelID)
}

func (s *Service) ResolveWorkspace(
	ctx context.Context,
	organizationID string,
	workspaceID string,
) (domainllm.Selection, error) {
	return s.repository.ResolveWorkspace(ctx, organizationID, workspaceID)
}

func (s *Service) Generate(
	ctx context.Context,
	organizationID string,
	workspaceID string,
	request domainllm.GenerateRequest,
) (domainllm.Generation, error) {
	selection, err := s.ResolveWorkspace(ctx, organizationID, workspaceID)
	if err != nil {
		return domainllm.Generation{}, err
	}
	if err := validateRequest(request, selection.Model.Capabilities); err != nil {
		return domainllm.Generation{}, err
	}
	secret, err := s.secrets.Read(ctx, selection.Provider.SecretRef)
	if err != nil {
		return domainllm.Generation{}, fmt.Errorf("read provider API key: %w", err)
	}
	apiKey := secret["apiKey"]
	if apiKey == "" {
		return domainllm.Generation{}, fmt.Errorf("provider API key is unavailable")
	}
	request.Model = selection.Model.Name
	return s.upstream.Generate(ctx, selection, apiKey, request)
}

func validateRequest(
	request domainllm.GenerateRequest,
	capabilities domainllm.Capabilities,
) error {
	if len(request.Messages) == 0 {
		return fmt.Errorf("%w: messages are required", domainllm.ErrInvalid)
	}
	if request.Stream && !capabilities.Streaming {
		return unsupportedCapability("streaming")
	}
	if request.Reasoning != nil && !capabilities.Reasoning {
		return unsupportedCapability("reasoning")
	}
	if request.Reasoning != nil && request.Reasoning.Effort != "" &&
		len(capabilities.ReasoningEfforts) != 0 &&
		!slices.Contains(capabilities.ReasoningEfforts, request.Reasoning.Effort) {
		return fmt.Errorf(
			"%w: selected model does not support reasoning effort %q",
			domainllm.ErrInvalid,
			request.Reasoning.Effort,
		)
	}
	if len(request.Tools) != 0 && !capabilities.Tools {
		return unsupportedCapability("tools")
	}
	if request.ResponseFormat != nil && !capabilities.StructuredOutput {
		return unsupportedCapability("structured output")
	}
	if request.MaxOutputTokens < 0 {
		return invalidRequest("maxOutputTokens cannot be negative")
	}
	if request.Temperature != nil && (*request.Temperature < 0 || *request.Temperature > 2) {
		return invalidRequest("temperature must be between 0 and 2")
	}
	if request.TopP != nil && (*request.TopP < 0 || *request.TopP > 1) {
		return invalidRequest("topP must be between 0 and 1")
	}
	if err := validateTools(request); err != nil {
		return err
	}
	for _, message := range request.Messages {
		if !slices.Contains(
			[]string{"system", "developer", "user", "assistant", "tool"},
			message.Role,
		) {
			return invalidRequest("unsupported message role")
		}
		if len(message.ToolCalls) != 0 && !capabilities.Tools {
			return unsupportedCapability("tools")
		}
		if message.Role == "tool" && message.ToolCallID == "" {
			return invalidRequest("tool messages require toolCallId")
		}
		for _, part := range message.Content {
			supported := part.Type == "text" && capabilities.TextInput
			supported = supported || part.Type == "reasoning" && capabilities.Reasoning
			supported = supported || part.Type == "image" && capabilities.ImageInput
			supported = supported || part.Type == "audio" && capabilities.AudioInput
			supported = supported || part.Type == "file" && capabilities.FileInput
			if !supported {
				return unsupportedCapability(part.Type + " input")
			}
			if part.Type != "text" && part.Type != "reasoning" {
				if part.Source == nil || (part.Source.URL == "" && part.Source.Data == "") {
					return invalidRequest(part.Type + " input requires a URL or data")
				}
			}
		}
	}
	return nil
}

func validateTools(request domainllm.GenerateRequest) error {
	for _, tool := range request.Tools {
		if strings.TrimSpace(tool.Name) == "" || !json.Valid(tool.InputSchema) {
			return invalidRequest("tools require a name and valid inputSchema")
		}
	}
	if request.ToolChoice != nil {
		choice := request.ToolChoice
		if !slices.Contains([]string{"auto", "none", "required", "tool"}, choice.Mode) {
			return invalidRequest("unsupported toolChoice mode")
		}
		if choice.Mode == "tool" && choice.Name == "" {
			return invalidRequest("toolChoice mode tool requires a name")
		}
	}
	if request.ResponseFormat != nil {
		format := request.ResponseFormat
		if !slices.Contains([]string{"text", "json_object", "json_schema"}, format.Type) {
			return invalidRequest("unsupported responseFormat type")
		}
		if format.Type == "json_schema" &&
			(format.Name == "" || !json.Valid(format.Schema)) {
			return invalidRequest("json_schema responseFormat requires a name and valid schema")
		}
	}
	return nil
}

func invalidRequest(message string) error {
	return fmt.Errorf("%w: %s", domainllm.ErrInvalid, message)
}

func unsupportedCapability(name string) error {
	return fmt.Errorf("%w: selected model does not support %s", domainllm.ErrInvalid, name)
}

func validateProvider(input ProviderInput, apiKeyRequired bool) (ProviderInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.APIBase = strings.TrimRight(strings.TrimSpace(input.APIBase), "/")
	if input.Name == "" || input.APIBase == "" {
		return input, fmt.Errorf("%w: name and apiBase are required", domainllm.ErrInvalid)
	}
	if !input.Kind.Valid() {
		return input, fmt.Errorf("%w: unsupported provider kind", domainllm.ErrInvalid)
	}
	parsed, err := url.Parse(input.APIBase)
	if err != nil || parsed.Host == "" || parsed.User != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return input, fmt.Errorf("%w: apiBase must be an HTTP(S) URL", domainllm.ErrInvalid)
	}
	if apiKeyRequired && strings.TrimSpace(input.APIKey) == "" {
		return input, fmt.Errorf("%w: apiKey is required", domainllm.ErrInvalid)
	}
	return input, nil
}

func validateModel(input ModelInput) (ModelInput, error) {
	input.ProviderID = strings.TrimSpace(input.ProviderID)
	input.Name = strings.TrimSpace(input.Name)
	input.UpstreamModel = strings.TrimSpace(input.UpstreamModel)
	if input.ProviderID == "" || input.Name == "" || input.UpstreamModel == "" {
		return input, fmt.Errorf(
			"%w: providerId, name, and upstreamModel are required",
			domainllm.ErrInvalid,
		)
	}
	if !input.Capabilities.TextInput {
		return input, fmt.Errorf(
			"%w: model capabilities must enable textInput",
			domainllm.ErrInvalid,
		)
	}
	defaultEffort := input.Capabilities.DefaultReasoningEffort
	if defaultEffort != "" &&
		!slices.Contains(input.Capabilities.ReasoningEfforts, defaultEffort) {
		return input, fmt.Errorf(
			"%w: defaultReasoningEffort must be included in reasoningEfforts",
			domainllm.ErrInvalid,
		)
	}
	return input, nil
}

func newID() string {
	entropy := ulid.Monotonic(rand.Reader, 0)
	return ulid.MustNew(ulid.Timestamp(time.Now()), entropy).String()
}
