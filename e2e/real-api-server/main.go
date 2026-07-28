package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/zaw-dev/zaw/internal/agenthost"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
	"github.com/zaw-dev/zaw/internal/domain"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	httptransport "github.com/zaw-dev/zaw/internal/interfaces/http"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	address      = "127.0.0.1:18080"
	workspaceID  = "e2e-real-workspace"
	organization = "01J00000000000000000000000"
	owner        = "01J00000000000000000000001"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := gorm.Open(sqlite.Open("file:e2e-real-api?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}
	controlPlane := httptransport.New(database, nil, &memorySecrets{})
	if err := controlPlane.Bootstrap(ctx); err != nil {
		log.Fatal(err)
	}
	workspaceDir, err := createWorkspace(database)
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(workspaceDir)

	server := &http.Server{
		Addr:              address,
		Handler:           controlPlane.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.ListenAndServe() }()

	hostDone := make(chan error, 1)
	go func() {
		hostDone <- agenthost.RunWithRuntime(ctx, agenthost.Config{
			ServerURL:    "http://" + address,
			WorkspaceID:  workspaceID,
			WorkspaceDir: workspaceDir,
		}, &fixtureRuntime{})
	}()

	select {
	case <-ctx.Done():
	case err := <-serverDone:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case err := <-hostDone:
		if err != nil {
			log.Fatal(err)
		}
	}
	controlPlane.CloseAHP()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}

func createWorkspace(database *gorm.DB) (string, error) {
	directory, err := os.MkdirTemp("", "zaw-real-api-e2e-")
	if err != nil {
		return "", err
	}
	cleanup := func(err error) (string, error) {
		_ = os.RemoveAll(directory)
		return "", err
	}
	if err := os.WriteFile(filepath.Join(directory, "README.md"), []byte("# Real API workspace\n"), 0o644); err != nil {
		return cleanup(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "src"), 0o755); err != nil {
		return cleanup(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "src", "agent.ts"), []byte("export const agent = true;\n"), 0o644); err != nil {
		return cleanup(err)
	}
	for _, arguments := range [][]string{
		{"init"},
		{"config", "user.email", "e2e@zaw.dev"},
		{"config", "user.name", "Zaw E2E"},
		{"add", "."},
		{"commit", "-m", "baseline"},
	} {
		command := exec.Command("git", arguments...)
		command.Dir = directory
		if output, err := command.CombinedOutput(); err != nil {
			return cleanup(fmt.Errorf("git %s: %w: %s", strings.Join(arguments, " "), err, output))
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "README.md"), []byte("# Real API workspace\n\nUncommitted change.\n"), 0o644); err != nil {
		return cleanup(err)
	}
	workspace := storage.Workspace{
		ID:              workspaceID,
		OrganizationID:  organization,
		Name:            "real-api-workspace",
		OwnerID:         owner,
		TemplateID:      "e2e-template",
		SourceSnapshot:  datatypes.JSON([]byte(`{}`)),
		ParameterValues: datatypes.JSON([]byte(`{}`)),
		DesiredState:    "running",
		ObservedState:   "running",
	}
	if err := database.Create(&workspace).Error; err != nil {
		return cleanup(err)
	}
	provider := storage.LLMProvider{
		ID:             "e2e-provider",
		OrganizationID: organization,
		Name:           "E2E Provider",
		Kind:           "openai",
		APIBase:        "http://127.0.0.1/unused",
		SecretRef:      "e2e/provider",
	}
	if err := database.Create(&provider).Error; err != nil {
		return cleanup(err)
	}
	model := storage.LLMModel{
		ID:            "e2e-model",
		ProviderID:    provider.ID,
		Name:          "Real API model",
		UpstreamModel: "fixture",
		IsDefault:     true,
		Capabilities:  datatypes.JSON([]byte(`{}`)),
	}
	if err := database.Create(&model).Error; err != nil {
		return cleanup(err)
	}
	return directory, nil
}

var _ domain.SecretStore = (*memorySecrets)(nil)

type memorySecrets struct{}

func (*memorySecrets) Put(context.Context, string, map[string]string) error { return nil }
func (*memorySecrets) Read(context.Context, string) (map[string]string, error) {
	return map[string]string{"api_key": "unused"}, nil
}
func (*memorySecrets) Delete(context.Context, string) error { return nil }

type fixtureRuntime struct {
	mu       sync.Mutex
	sequence int
}

func (runtime *fixtureRuntime) CreateSession(_ context.Context, options agentsdk.SessionOptions) (agentsdk.Session, error) {
	runtime.mu.Lock()
	runtime.sequence++
	identifier := runtime.sequence
	runtime.mu.Unlock()
	return &fixtureSession{id: identifier, options: options}, nil
}

func (*fixtureRuntime) Close() error { return nil }

type fixtureSession struct {
	id      int
	options agentsdk.SessionOptions
}

func (session *fixtureSession) ID() string { return fmt.Sprintf("real-api-%d", session.id) }

func (session *fixtureSession) Prompt(ctx context.Context, prompt agentsdk.PromptRequest) error {
	session.options.OnEvent(agentsdk.Event{
		Type: "agent_message_chunk",
		Data: map[string]string{"text": "Response from the real Agent Host"},
	})
	decision := session.options.OnPermission(ctx, agentsdk.PermissionRequest{
		ID:   fmt.Sprintf("permission-%d", session.id),
		Kind: "shell",
		Data: json.RawMessage(`{"command":"printf real-api"}`),
	})
	if decision == agentsdk.PermissionAllowOnce {
		session.options.OnEvent(agentsdk.Event{
			Type: "tool_call",
			Data: map[string]string{"toolCallId": fmt.Sprintf("tool-%d", session.id), "status": "completed"},
		})
	}
	return nil
}

func (*fixtureSession) Cancel(context.Context) error { return nil }
func (*fixtureSession) Close() error                 { return nil }
