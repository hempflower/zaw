package httptransport

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/oklog/ulid/v2"
	"github.com/zaw-dev/zaw/internal/domain"
	"github.com/zaw-dev/zaw/internal/infra/llmproxy"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	buildservice "github.com/zaw-dev/zaw/internal/usecase/build"
	llmservice "github.com/zaw-dev/zaw/internal/usecase/llm"
	sessionservice "github.com/zaw-dev/zaw/internal/usecase/session"
	workspaceservice "github.com/zaw-dev/zaw/internal/usecase/workspace"
	"gorm.io/gorm"
)

const devOrganizationID = "01J00000000000000000000000"
const devUserID = "01J00000000000000000000001"

//go:embed web/*
var web embed.FS

type Server struct {
	db             *gorm.DB
	sourceResolver domain.SourceResolver
	secrets        domain.SecretStore
	agentIdentity  domain.AgentHostIdentity
	ahp            *ahpGateway
	logger         *slog.Logger
	builds         buildservice.Service
	workspaceLife  workspaceservice.Service
	models         *llmservice.Service
	sessions       *sessionservice.Service
	auth           authentication
}

func New(
	db *gorm.DB,
	sourceResolver domain.SourceResolver,
	secrets domain.SecretStore,
) *Server {
	var models *llmservice.Service
	var sessions *sessionservice.Service
	if db != nil && secrets != nil {
		models = llmservice.New(
			storage.NewLLMRepository(db),
			secrets,
			llmproxy.NewClient(nil),
		)
	}
	if db != nil {
		sessions = sessionservice.New(storage.NewSessionRepository(db))
	}
	return &Server{
		db:             db,
		sourceResolver: sourceResolver,
		secrets:        secrets,
		ahp:            newAHPGateway(),
		logger:         slog.Default(),
		builds:         buildservice.Service{},
		workspaceLife:  workspaceservice.Service{},
		models:         models,
		sessions:       sessions,
	}
}

// NewWithAgentIdentity enables fixed Workspace-scoped credentials for Agent Hosts.
// New remains useful for isolated transport tests that do not start a real Host.
func NewWithAgentIdentity(
	db *gorm.DB,
	sourceResolver domain.SourceResolver,
	secrets domain.SecretStore,
	identity domain.AgentHostIdentity,
) *Server {
	server := New(db, sourceResolver, secrets)
	server.agentIdentity = identity
	return server
}

func (s *Server) Bootstrap(ctx context.Context) error {
	if err := storage.Migrate(s.db); err != nil {
		return err
	}
	return s.seedDevelopmentIdentity(ctx)
}

func (s *Server) ConfigureAuthentication(password, provisionerKey, signingKey string) {
	s.auth.configure(password, provisionerKey, signingKey)
}

func (s *Server) Handler() http.Handler { return s.routes() }

// CloseAHP releases live Host sockets during a control-plane shutdown.
func (s *Server) CloseAHP() { s.ahp.closeAll() }

func (s *Server) seedDevelopmentIdentity(ctx context.Context) error {
	organization := storage.Organization{
		ID:   devOrganizationID,
		Name: "Local development",
	}
	if err := s.db.WithContext(ctx).
		Where("id = ?", devOrganizationID).
		FirstOrCreate(&organization).Error; err != nil {
		return err
	}
	user := storage.User{
		ID:          devUserID,
		Email:       "admin@local.zaw",
		DisplayName: "Development Administrator",
	}
	if err := s.db.WithContext(ctx).
		Where("id = ?", devUserID).
		FirstOrCreate(&user).Error; err != nil {
		return err
	}
	membership := storage.Membership{
		OrganizationID: devOrganizationID,
		UserID:         devUserID,
		Role:           "admin",
	}
	return s.db.WithContext(ctx).
		Where("organization_id = ? AND user_id = ?", devOrganizationID, devUserID).
		FirstOrCreate(&membership).Error
}

func (s *Server) routes() http.Handler {
	router := chi.NewRouter()
	router.Use(withJSON)
	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/downloads/zaw/{goos}/{goarch}", s.agentHostRuntimeDownload)
	router.Head("/downloads/zaw/{goos}/{goarch}", s.agentHostRuntimeDownload)
	router.Get("/api/v1/auth/status", s.auth.status)
	router.Post("/api/v1/auth/login", s.auth.login)
	router.Post("/api/v1/auth/logout", s.auth.logout)
	router.Route("/api/v1", func(api chi.Router) {
		api.Group(func(provisioner chi.Router) {
			provisioner.Use(s.auth.requireProvisioner)
			provisioner.Post("/provisioners/register", s.registerProvisioner)
			provisioner.Post("/provisioners/{id}/heartbeat", s.provisionerHeartbeat)
			provisioner.Post("/provisioners/{id}/claim", s.claimJob)
			provisioner.Post("/provisioners/{id}/jobs/{jobID}/events", s.jobEvent)
			provisioner.Post(
				"/provisioners/{id}/jobs/{jobID}/credentials/{credentialID}/secret",
				s.buildCredentialSecret,
			)
			provisioner.Post("/provisioners/{id}/jobs/{jobID}/agent-host-token", s.agentHostToken)
		})
		api.Post("/agent-hosts/{workspaceID}/telemetry", s.telemetry)
		api.Get("/agent-hosts/{workspaceID}/model", s.agentHostModel)
		api.Get("/agent-hosts/{workspaceID}/runtime", s.agentHostRuntime)
		api.Head("/agent-hosts/{workspaceID}/runtime", s.agentHostRuntime)
		api.Get("/agent-hosts/{workspaceID}/ahp", s.agentHostAHP)
		api.Get("/llm/models", s.llmModels)
		api.Post("/llm/generate", s.generateModel)
		api.Post("/llm/openai/responses", s.openAIResponses)
		api.Post("/llm/openai/v1/responses", s.openAIResponses)
		api.Group(func(api chi.Router) {
			api.Use(s.auth.requireUser)
			api.Get("/me", s.me)
			api.Get("/templates", s.templates)
			api.Post("/templates", s.templates)
			api.Get("/templates/{id}", s.template)
			api.Patch("/templates/{id}", s.template)
			api.Delete("/templates/{id}", s.template)
			api.Get("/credentials", s.credentials)
			api.Post("/credentials", s.credentials)
			api.Patch("/credentials/{id}", s.credential)
			api.Delete("/credentials/{id}", s.credential)
			api.Get("/model-providers", s.modelProviders)
			api.Post("/model-providers", s.modelProviders)
			api.Patch("/model-providers/{id}", s.modelProvider)
			api.Delete("/model-providers/{id}", s.modelProvider)
			api.Get("/models", s.modelConfigurations)
			api.Post("/models", s.modelConfigurations)
			api.Patch("/models/{id}", s.modelConfiguration)
			api.Delete("/models/{id}", s.modelConfiguration)
			api.Get("/workspaces", s.workspaces)
			api.Post("/workspaces", s.workspaces)
			api.Get("/workspaces/{id}", s.workspace)
			api.Post("/workspaces/{id}/builds", s.workspaceBuilds)
			api.Get("/builds/{id}", s.build)
			api.Get("/builds/{id}/logs", s.buildLogs)
			api.Get("/builds", s.listBuilds)
			api.Get("/provisioners", s.provisioners)
			api.Get("/provisioner-jobs", s.provisionerJobs)
			api.Get("/workspaces/{workspaceID}/ahp", s.workspaceAHP)
			api.Get("/sessions", s.sessionCatalog)
		})
	})
	static, _ := fs.Sub(web, "web")
	router.Handle("/*", http.FileServer(http.FS(static)))
	return router
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
		next.ServeHTTP(w, r)
	})
}
func decode(r *http.Request, v any) error {
	return decodeLimit(r, v, 2<<20)
}

func decodeLimit(r *http.Request, v any, limit int64) error {
	d := json.NewDecoder(io.LimitReader(r.Body, limit))
	d.DisallowUnknownFields()
	return d.Decode(v)
}
func respond(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}

func routeParam(r *http.Request, name string) string {
	return chi.URLParam(r, name)
}
func id() string {
	entropy := ulid.Monotonic(rand.Reader, 0)
	return ulid.MustNew(ulid.Timestamp(time.Now()), entropy).String()
}
func (s *Server) audit(
	ctx context.Context,
	action string,
	targetType string,
	targetID string,
	detail any,
) {
	b, _ := json.Marshal(detail)
	_ = s.db.WithContext(ctx).Create(&storage.AuditLog{
		ID:             id(),
		OrganizationID: devOrganizationID,
		ActorID:        devUserID,
		Action:         action,
		TargetType:     targetType,
		TargetID:       targetID,
		Detail:         b,
	}).Error
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]any{
		"organizationId":      devOrganizationID,
		"userId":              devUserID,
		"role":                "admin",
		"developmentIdentity": true,
	})
}
