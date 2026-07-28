// Package copilot adapts the official GitHub Copilot Go SDK to Agent Host.
package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	copilotsdk "github.com/github/copilot-sdk/go"
	"github.com/github/copilot-sdk/go/rpc"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

// Copilot CLI 1.0.75 defaults Autopilot to five continuations and does not
// expose an unlimited sentinel. The CLI parses this value as a JavaScript
// number, so its maximum safe integer is the closest compatible no-limit value.
const unlimitedAutopilotContinues = "9007199254740991"

const autopilotContinuationPrompt = "You have not yet marked the task as complete using the task_complete tool. If you were planning, stop planning and start implementing. You aren't done until you have fully completed the task."

type Config struct {
	CLIPath          string
	WorkingDirectory string
	Model            string
	Models           []ModelConfig
	LLMBaseURL       string
	LLMToken         string
	Vision           bool
	Reasoning        bool
	ReasoningEfforts []string
	ReasoningEffort  string
	ContextWindow    int
}

type ModelConfig struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Capabilities struct {
		ImageInput       bool     `json:"imageInput"`
		Reasoning        bool     `json:"reasoning"`
		ReasoningEfforts []string `json:"reasoningEfforts"`
		ContextWindow    int      `json:"contextWindow"`
	} `json:"capabilities"`
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
	contextWindow := config.ContextWindow
	if contextWindow <= 0 {
		contextWindow = 128000
	}
	models := modelInfos(config, contextWindow)
	options.OnListModels = func(context.Context) ([]copilotsdk.ModelInfo, error) {
		return models, nil
	}
	options.Connection = copilotsdk.StdioConnection{
		Path: config.CLIPath,
		Args: copilotCLIArgs(),
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
			Type: "openai", WireAPI: "responses", BaseURL: config.LLMBaseURL,
			BearerToken: config.LLMToken,
		},
	}, nil
}

func modelInfos(config Config, fallbackContextWindow int) []copilotsdk.ModelInfo {
	if len(config.Models) == 0 {
		return []copilotsdk.ModelInfo{{
			ID: config.Model, Name: config.Model,
			Capabilities: copilotsdk.ModelCapabilities{
				Supports: copilotsdk.ModelSupports{
					Vision: config.Vision, ReasoningEffort: config.Reasoning,
				},
				Limits: copilotsdk.ModelLimits{MaxContextWindowTokens: &fallbackContextWindow},
			},
			SupportedReasoningEfforts: config.ReasoningEfforts,
		}}
	}
	result := make([]copilotsdk.ModelInfo, 0, len(config.Models))
	for _, model := range config.Models {
		contextWindow := model.Capabilities.ContextWindow
		if contextWindow <= 0 {
			contextWindow = fallbackContextWindow
		}
		result = append(result, copilotsdk.ModelInfo{
			ID: model.ID, Name: model.Name,
			Capabilities: copilotsdk.ModelCapabilities{
				Supports: copilotsdk.ModelSupports{
					Vision:          model.Capabilities.ImageInput,
					ReasoningEffort: model.Capabilities.Reasoning,
				},
				Limits: copilotsdk.ModelLimits{MaxContextWindowTokens: &contextWindow},
			},
			SupportedReasoningEfforts: model.Capabilities.ReasoningEfforts,
		})
	}
	return result
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
	wrapped := &copilotSession{model: model, onEvent: options.OnEvent}
	session, err := r.client.CreateSession(ctx, &copilotsdk.SessionConfig{
		SessionID:        options.ID,
		ClientName:       "zaw-agent-host",
		Model:            model,
		ReasoningEffort:  r.effort,
		WorkingDirectory: options.WorkingDirectory,
		Streaming:        &streaming,
		Provider:         &r.provider,
		OnEvent: func(event copilotsdk.SessionEvent) {
			wrapped.handleEvent(event)
		},
		OnPermissionRequest: permissionHandler(options.OnPermission),
	})
	if err != nil {
		return nil, fmt.Errorf("create GitHub Copilot session: %w", err)
	}
	wrapped.session = session
	return wrapped, nil
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
	session      *copilotsdk.Session
	model        string
	onEvent      func(agentsdk.Event)
	mu           sync.Mutex
	autopilot    bool
	taskComplete bool
	continuing   bool
}

func (s *copilotSession) ID() string {
	return s.session.SessionID
}

func (s *copilotSession) Prompt(
	ctx context.Context,
	request agentsdk.PromptRequest,
) error {
	mode := sessionMode(request.AgentMode)
	if _, err := s.session.RPC.Mode.Set(ctx, &rpc.ModeSetRequest{Mode: mode}); err != nil {
		return fmt.Errorf("set agent mode: %w", err)
	}
	if request.Model != "" && (request.Model != s.model || request.ReasoningEffort != "") {
		var options *copilotsdk.SetModelOptions
		if request.ReasoningEffort != "" {
			effort := request.ReasoningEffort
			options = &copilotsdk.SetModelOptions{ReasoningEffort: &effort}
		}
		if err := s.session.SetModel(ctx, request.Model, options); err != nil {
			return err
		}
		s.model = request.Model
	}
	attachments := make([]copilotsdk.Attachment, 0, len(request.Attachments))
	for _, attachment := range request.Attachments {
		label := attachment.Label
		attachments = append(attachments, &copilotsdk.AttachmentBlob{
			Data:        &attachment.Data,
			DisplayName: &label,
			MIMEType:    attachment.ContentType,
		})
	}
	s.beginTurn(request.AgentMode == "autopilot")
	_, err := s.session.Send(ctx, messageOptions(request, attachments))
	if err != nil {
		s.endTurn()
	}
	return err
}

func (s *copilotSession) handleEvent(event copilotsdk.SessionEvent) {
	eventType := string(event.Type())
	forward, continueAutopilot := s.eventDisposition(eventType)
	if forward {
		s.forwardEvent(agentsdk.Event{
			ID:        event.ID,
			Type:      eventType,
			Timestamp: event.Timestamp,
			Data:      event.Data,
		})
	}
	if continueAutopilot {
		go s.continueAutopilot()
	}
}

func (s *copilotSession) beginTurn(autopilot bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autopilot = autopilot
	s.taskComplete = false
	s.continuing = false
}

func (s *copilotSession) endTurn() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autopilot = false
	s.taskComplete = false
	s.continuing = false
}

func (s *copilotSession) eventDisposition(eventType string) (forward, continueAutopilot bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch eventType {
	case "session.task_complete":
		s.taskComplete = true
		return true, false
	case "session.error":
		s.autopilot = false
		s.continuing = false
		return true, false
	case "session.idle":
		if s.autopilot && !s.taskComplete {
			if !s.continuing {
				s.continuing = true
				return false, true
			}
			return false, false
		}
		s.autopilot = false
		s.continuing = false
		return true, false
	default:
		return true, false
	}
}

func (s *copilotSession) continueAutopilot() {
	// The continuation is a separate model response, but AHP keeps one Markdown
	// response part per turn. Preserve the response boundary without exposing the nudge.
	s.forwardEvent(agentsdk.Event{
		Type: "assistant.message_delta",
		Data: map[string]string{"content": "\n\n"},
	})
	_, err := s.session.Send(context.Background(), copilotsdk.MessageOptions{
		Prompt:    autopilotContinuationPrompt,
		AgentMode: copilotsdk.AgentModeAutopilot,
	})
	s.mu.Lock()
	s.continuing = false
	if err != nil {
		s.autopilot = false
	}
	s.mu.Unlock()
	if err != nil {
		s.forwardEvent(agentsdk.Event{
			Type: "session.error",
			Data: map[string]any{
				"message": fmt.Sprintf("continue Autopilot session: %v", err),
			},
		})
	}
}

func (s *copilotSession) forwardEvent(event agentsdk.Event) {
	if s.onEvent != nil {
		s.onEvent(event)
	}
}

func messageOptions(
	request agentsdk.PromptRequest,
	attachments []copilotsdk.Attachment,
) copilotsdk.MessageOptions {
	return copilotsdk.MessageOptions{
		Prompt:      request.Text,
		Attachments: attachments,
		AgentMode:   sendAgentMode(request.AgentMode),
	}
}

func copilotCLIArgs() []string {
	return []string{
		"--autopilot",
		"--max-autopilot-continues", unlimitedAutopilotContinues,
	}
}

func sessionMode(mode string) rpc.SessionMode {
	switch mode {
	case "plan":
		return rpc.SessionModePlan
	case "autopilot":
		return rpc.SessionModeAutopilot
	default:
		return rpc.SessionModeInteractive
	}
}

func sendAgentMode(mode string) copilotsdk.AgentMode {
	switch mode {
	case "plan":
		return copilotsdk.AgentModePlan
	case "autopilot":
		return copilotsdk.AgentModeAutopilot
	default:
		return copilotsdk.AgentModeInteractive
	}
}

func (s *copilotSession) Cancel(ctx context.Context) error {
	s.endTurn()
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
