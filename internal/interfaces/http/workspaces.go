package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	domainworkspace "github.com/zaw-dev/zaw/internal/domain/workspace"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type workspaceInput struct {
	Name       string         `json:"name"`
	TemplateID string         `json:"templateId"`
	ModelID    string         `json:"modelId"`
	Parameters map[string]any `json:"parameters"`
}

type workspaceView struct {
	ID                 string                  `json:"id"`
	Name               string                  `json:"name"`
	TemplateID         string                  `json:"templateId"`
	ModelID            string                  `json:"modelId"`
	DesiredState       string                  `json:"desiredState"`
	ObservedState      string                  `json:"observedState"`
	AgentHostState     string                  `json:"agentHostState"`
	AgentHostTelemetry *agentHostTelemetryView `json:"agentHostTelemetry,omitempty"`
	CurrentBuildID     string                  `json:"currentBuildId"`
	SourceSnapshot     json.RawMessage         `json:"sourceSnapshot"`
	Parameters         json.RawMessage         `json:"parameters"`
	CreatedAt          string                  `json:"createdAt"`
}

type agentHostTelemetryView struct {
	Health      string  `json:"health"`
	CPUPercent  float64 `json:"cpuPercent"`
	MemoryBytes uint64  `json:"memoryBytes"`
}

type buildInput struct {
	Operation string `json:"operation"`
}

func (s *Server) workspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		s.createWorkspace(w, r)
		return
	}
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var workspaces []storage.Workspace
	if err := s.db.WithContext(r.Context()).
		Where("organization_id = ? AND desired_state <> ?", devOrganizationID, "deleted").
		Order("updated_at DESC").
		Find(&workspaces).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]workspaceView, 0, len(workspaces))
	telemetry := make(map[string]*agentHostTelemetryView, len(workspaces))
	var agentHosts []storage.AgentHost
	if err := s.db.WithContext(r.Context()).Find(&agentHosts).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, host := range agentHosts {
		telemetry[host.WorkspaceID] = parseAgentHostTelemetry(host.LastTelemetry)
	}
	for _, workspace := range workspaces {
		items = append(items, workspaceToView(
			workspace,
			s.agentHostState(workspace.ID),
			telemetry[workspace.ID],
		))
	}
	respond(w, http.StatusOK, items)
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var input workspaceInput
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.Name == "" || input.TemplateID == "" {
		fail(w, http.StatusBadRequest, "name and templateId are required")
		return
	}
	if input.ModelID != "" {
		if _, err := s.models.GetModel(r.Context(), devOrganizationID, input.ModelID); err != nil {
			handleModelError(w, err)
			return
		}
	}
	snapshot, err := s.currentSource(r.Context(), input.TemplateID)
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	parameters, _ := json.Marshal(input.Parameters)
	workspaceID, buildID := id(), id()
	err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		workspace := storage.Workspace{
			ID: workspaceID, OrganizationID: devOrganizationID, Name: input.Name,
			OwnerID: devUserID, TemplateID: input.TemplateID, SourceSnapshot: snapshot,
			ParameterValues: datatypes.JSON(parameters), DesiredState: "running",
			ObservedState: "pending", CurrentBuildID: buildID,
			ModelID: input.ModelID,
		}
		if err := tx.Create(&workspace).Error; err != nil {
			return err
		}
		build := storage.WorkspaceBuild{
			ID: buildID, WorkspaceID: workspaceID, Operation: "create", RequestedBy: devUserID,
			SourceSnapshot: snapshot, ParameterSnapshot: datatypes.JSON(parameters), Status: "queued",
			Logs: "", ResourceSummary: datatypes.JSON([]byte(`{}`)),
		}
		if err := tx.Create(&build).Error; err != nil {
			return err
		}
		return tx.Create(&storage.ProvisionerJob{
			ID: id(), BuildID: buildID, Status: "queued",
		}).Error
	})
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(
		r.Context(),
		"workspace.created",
		"workspace",
		workspaceID,
		map[string]string{"buildId": buildID},
	)
	respond(w, http.StatusCreated, map[string]string{"id": workspaceID, "buildId": buildID})
}

func (s *Server) workspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var workspace storage.Workspace
	err := s.db.WithContext(r.Context()).
		Where("id = ? AND organization_id = ?", routeParam(r, "id"), devOrganizationID).
		First(&workspace).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "workspace not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	var agentHost storage.AgentHost
	telemetry := (*agentHostTelemetryView)(nil)
	if err := s.db.WithContext(r.Context()).
		Where("workspace_id = ?", workspace.ID).
		First(&agentHost).Error; err == nil {
		telemetry = parseAgentHostTelemetry(agentHost.LastTelemetry)
	} else if err != gorm.ErrRecordNotFound {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, workspaceToView(
		workspace,
		s.agentHostState(workspace.ID),
		telemetry,
	))
}

func (s *Server) workspaceBuilds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var input buildInput
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	operation, err := domainworkspace.ParseBuildOperation(input.Operation)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid operation")
		return
	}
	var workspace storage.Workspace
	err = s.db.WithContext(r.Context()).
		Where("id = ? AND organization_id = ?", routeParam(r, "id"), devOrganizationID).
		First(&workspace).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "workspace not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	nextDesiredState, err := s.workspaceLife.NextDesiredState(
		domainworkspace.Workspace{
			ID:             workspace.ID,
			OrganizationID: workspace.OrganizationID,
			TemplateID:     workspace.TemplateID,
			DesiredState:   domainworkspace.DesiredState(workspace.DesiredState),
			ObservedState:  domainworkspace.ObservedState(workspace.ObservedState),
		},
		operation,
	)
	if err != nil {
		fail(w, http.StatusConflict, "illegal workspace state transition")
		return
	}
	snapshot := workspace.SourceSnapshot
	if input.Operation == "rebuild-from-current-template" {
		snapshot, err = s.currentSource(r.Context(), workspace.TemplateID)
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, "current template source unavailable")
			return
		}
	}
	buildID := id()
	err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		build := storage.WorkspaceBuild{
			ID: buildID, WorkspaceID: workspace.ID, Operation: input.Operation, RequestedBy: devUserID,
			SourceSnapshot: snapshot, ParameterSnapshot: workspace.ParameterValues, Status: "queued",
			Logs: "", ResourceSummary: datatypes.JSON([]byte(`{}`)),
		}
		if err := tx.Create(&build).Error; err != nil {
			return err
		}
		job := storage.ProvisionerJob{
			ID:      id(),
			BuildID: buildID,
			Status:  "queued",
		}
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		return tx.Model(&workspace).Updates(map[string]any{
			"desired_state":  nextDesiredState,
			"observed_state": "pending", "current_build_id": buildID,
		}).Error
	})
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if nextDesiredState != domainworkspace.DesiredRunning {
		s.ahp.disconnect(workspace.ID)
	}
	s.audit(
		r.Context(),
		"workspace.build_requested",
		"workspace",
		workspace.ID,
		map[string]string{"operation": input.Operation, "buildId": buildID},
	)
	respond(w, http.StatusAccepted, map[string]string{"id": buildID})
}

func (s *Server) currentSource(ctx context.Context, templateID string) (datatypes.JSON, error) {
	var template storage.Template
	if err := s.db.WithContext(ctx).Where("id = ?", templateID).First(&template).Error; err != nil {
		return nil, err
	}
	var source storage.TemplateSource
	if err := s.db.WithContext(ctx).
		Where("template_id = ?", templateID).
		First(&source).Error; err != nil {
		return nil, err
	}
	return sourceJSON(templateSourceInput{
		Kind:         source.Kind,
		URL:          source.URL,
		Ref:          source.RefName,
		Commit:       source.CommitSHA,
		SHA256:       source.SHA256,
		Format:       source.ArchiveFormat,
		Directory:    source.Directory,
		CredentialID: source.CredentialID,
	}), nil
}

func (s *Server) build(w http.ResponseWriter, r *http.Request) {
	var build storage.WorkspaceBuild
	err := s.db.WithContext(r.Context()).Where("id = ?", routeParam(r, "id")).First(&build).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "build not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{
		"id":            build.ID,
		"workspaceId":   build.WorkspaceID,
		"operation":     build.Operation,
		"status":        build.Status,
		"provisionerId": build.ProvisionerID,
		"resources":     json.RawMessage(build.ResourceSummary),
		"error":         build.ErrorMessage,
		"createdAt":     build.CreatedAt.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Server) listBuilds(w http.ResponseWriter, r *http.Request) {
	var items []storage.WorkspaceBuild
	if err := s.db.WithContext(r.Context()).Order("created_at DESC").Limit(100).
		Find(&items).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	views := make([]map[string]any, 0, len(items))
	for _, item := range items {
		views = append(views, map[string]any{
			"createdAt": item.CreatedAt.UTC().Format(time.RFC3339Nano),
			"error":     item.ErrorMessage, "id": item.ID, "logs": item.Logs,
			"operation": item.Operation, "provisionerId": item.ProvisionerID,
			"status": item.Status, "workspaceId": item.WorkspaceID,
		})
	}
	respond(w, http.StatusOK, views)
}

func (s *Server) buildLogs(w http.ResponseWriter, r *http.Request) {
	var build storage.WorkspaceBuild
	err := s.db.WithContext(r.Context()).Where("id = ?", routeParam(r, "id")).First(&build).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "build not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]string{"logs": build.Logs})
}

func workspaceToView(
	workspace storage.Workspace,
	agentHostState string,
	telemetry *agentHostTelemetryView,
) workspaceView {
	if agentHostState == "" {
		agentHostState = "offline"
	}
	return workspaceView{
		ID:                 workspace.ID,
		Name:               workspace.Name,
		TemplateID:         workspace.TemplateID,
		ModelID:            workspace.ModelID,
		DesiredState:       workspace.DesiredState,
		ObservedState:      workspace.ObservedState,
		AgentHostState:     agentHostState,
		AgentHostTelemetry: telemetry,
		CurrentBuildID:     workspace.CurrentBuildID,
		SourceSnapshot:     json.RawMessage(workspace.SourceSnapshot),
		Parameters:         json.RawMessage(workspace.ParameterValues),
		CreatedAt:          workspace.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func parseAgentHostTelemetry(payload datatypes.JSON) *agentHostTelemetryView {
	var telemetry agentHostTelemetryView
	if len(payload) == 0 || json.Unmarshal(payload, &telemetry) != nil {
		return nil
	}
	return &telemetry
}

func (s *Server) agentHostState(workspaceID string) string {
	if s.ahp.isOnline(workspaceID) {
		return "online"
	}
	return "offline"
}
