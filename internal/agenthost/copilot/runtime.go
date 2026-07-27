// Package copilot adapts the official GitHub Copilot Go SDK to Agent Host.
package copilot

import (
	"context"
	"encoding/json"
	"fmt"

	copilotsdk "github.com/github/copilot-sdk/go"
	"github.com/github/copilot-sdk/go/rpc"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

type Config struct {
	CLIPath          string
	WorkingDirectory string
	Model            string
	LLMBaseURL       string
	LLMToken         string
	Vision           bool
	Reasoning        bool
	ReasoningEfforts []string
	ReasoningEffort  string
}

type Runtime struct {
	client   *copilotsdk.Client
	model    string
	provider copilotsdk.ProviderConfig
	effort   string
}

func New(ctx context.Context, config Config) (*Runtime, error) {
	model := config.Model
	if model == "" {
		return nil, fmt.Errorf("Server did not provide a model for GitHub Copilot SDK")
	}
	if config.LLMBaseURL == "" || config.LLMToken == "" {
		return nil, fmt.Errorf("Server model gateway configuration is incomplete")
	}
	options := &copilotsdk.ClientOptions{
		WorkingDirectory: config.WorkingDirectory,
		LogLevel:         "error",
	}
	capability := copilotsdk.ModelCapabilities{
		Supports: copilotsdk.ModelSupports{
			Vision: config.Vision, ReasoningEffort: config.Reasoning,
		},
		Limits: copilotsdk.ModelLimits{MaxContextWindowTokens: 128000},
	}
	options.OnListModels = func(context.Context) ([]copilotsdk.ModelInfo, error) {
		return []copilotsdk.ModelInfo{{
			ID: model, Name: model, Capabilities: capability,
			SupportedReasoningEfforts: config.ReasoningEfforts,
		}}, nil
	}
	if config.CLIPath != "" {
		options.Connection = copilotsdk.StdioConnection{Path: config.CLIPath}
	}
	client := copilotsdk.NewClient(options)
	if err := client.Start(ctx); err != nil {
		return nil, fmt.Errorf("start GitHub Copilot SDK: %w", err)
	}
	return &Runtime{
		client: client,
		model:  model,
		effort: defaultReasoningEffort(config),
		provider: copilotsdk.ProviderConfig{
			Type: "openai", WireApi: "responses", BaseURL: config.LLMBaseURL,
			BearerToken: config.LLMToken, ModelID: model, WireModel: model,
		},
	}, nil
}

func (r *Runtime) CreateSession(
	ctx context.Context,
	options agentsdk.SessionOptions,
) (agentsdk.Session, error) {
	streaming := true
	model := options.Model
	if model == "" {
		model = r.model
	}
	session, err := r.client.CreateSession(ctx, &copilotsdk.SessionConfig{
		SessionID:        options.ID,
		ClientName:       "zaw-agent-host",
		Model:            model,
		ReasoningEffort:  r.effort,
		WorkingDirectory: options.WorkingDirectory,
		Streaming:        &streaming,
		Provider:         &r.provider,
		OnEvent: func(event copilotsdk.SessionEvent) {
			if options.OnEvent != nil {
				options.OnEvent(agentsdk.Event{
					ID:        event.ID,
					Type:      string(event.Type()),
					Timestamp: event.Timestamp,
					Data:      event.Data,
				})
			}
		},
		OnPermissionRequest: permissionHandler(options.OnPermission),
	})
	if err != nil {
		return nil, fmt.Errorf("create GitHub Copilot session: %w", err)
	}
	return &copilotSession{session: session, model: model}, nil
}

func defaultReasoningEffort(config Config) string {
	if config.ReasoningEffort != "" {
		return config.ReasoningEffort
	}
	if len(config.ReasoningEfforts) != 0 {
		return config.ReasoningEfforts[0]
	}
	return ""
}

func (r *Runtime) Close() error {
	return r.client.Stop()
}

type copilotSession struct {
	session *copilotsdk.Session
	model   string
}

func (s *copilotSession) ID() string {
	return s.session.SessionID
}

func (s *copilotSession) Prompt(
	ctx context.Context,
	request agentsdk.PromptRequest,
) error {
	if request.Model != "" && request.Model != s.model {
		if err := s.session.SetModel(ctx, request.Model, nil); err != nil {
			return err
		}
		s.model = request.Model
	}
	attachments := make([]copilotsdk.Attachment, 0, len(request.Attachments))
	for _, attachment := range request.Attachments {
		label := attachment.Label
		attachments = append(attachments, &copilotsdk.UserMessageAttachmentBlob{
			Data:        attachment.Data,
			DisplayName: &label,
			MIMEType:    attachment.ContentType,
		})
	}
	_, err := s.session.Send(ctx, copilotsdk.MessageOptions{
		Prompt:      request.Text,
		Attachments: attachments,
	})
	return err
}

func (s *copilotSession) Cancel(ctx context.Context) error {
	return s.session.Abort(ctx)
}

func (s *copilotSession) Close() error {
	return s.session.Disconnect()
}

func permissionHandler(
	handler func(context.Context, agentsdk.PermissionRequest) agentsdk.PermissionDecision,
) copilotsdk.PermissionHandlerFunc {
	return func(
		request copilotsdk.PermissionRequest,
		invocation copilotsdk.PermissionInvocation,
	) (rpc.PermissionDecision, error) {
		if handler == nil {
			return &rpc.PermissionDecisionUserNotAvailable{}, nil
		}
		payload, _ := json.Marshal(request)
		decision := handler(context.Background(), agentsdk.PermissionRequest{
			ID:   invocation.SessionID,
			Kind: string(request.Kind()),
			Data: payload,
		})
		switch decision {
		case agentsdk.PermissionAllowOnce:
			return &rpc.PermissionDecisionApproveOnce{}, nil
		case agentsdk.PermissionCancel:
			return &rpc.PermissionDecisionCancelled{}, nil
		default:
			return &rpc.PermissionDecisionReject{}, nil
		}
	}
}
