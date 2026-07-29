package httptransport

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	domainbuild "github.com/zaw-dev/zaw/internal/domain/build"
	domainworkspace "github.com/zaw-dev/zaw/internal/domain/workspace"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type provisionerRegistration struct {
	Name         string         `json:"name"`
	Capabilities map[string]any `json:"capabilities"`
}

func (s *Server) provisioners(w http.ResponseWriter, r *http.Request) {
	var items []storage.Provisioner
	if err := s.db.WithContext(r.Context()).Order("created_at DESC").Find(&items).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	views := make([]map[string]any, 0, len(items))
	for _, item := range items {
		views = append(views, map[string]any{
			"capabilities": json.RawMessage(item.Capabilities), "id": item.ID,
			"lastHeartbeatAt": item.LastHeartbeatAt.UTC().Format(time.RFC3339Nano),
			"name":            item.Name, "status": item.Status,
		})
	}
	respond(w, http.StatusOK, views)
}

func (s *Server) provisionerJobs(w http.ResponseWriter, r *http.Request) {
	var items []storage.ProvisionerJob
	if err := s.db.WithContext(r.Context()).Order("created_at DESC").Limit(100).
		Find(&items).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	views := make([]map[string]any, 0, len(items))
	for _, item := range items {
		views = append(views, map[string]any{
			"attempt": item.Attempt, "buildId": item.BuildID,
			"claimedBy": item.ClaimedBy, "id": item.ID, "status": item.Status,
		})
	}
	respond(w, http.StatusOK, views)
}

func (s *Server) registerProvisioner(w http.ResponseWriter, r *http.Request) {
	var input provisionerRegistration
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.Name == "" {
		fail(w, http.StatusBadRequest, "name is required")
		return
	}
	payload, _ := json.Marshal(input.Capabilities)
	provisioner := storage.Provisioner{
		ID: id(), Name: input.Name, Capabilities: datatypes.JSON(payload), Status: "online",
		LastHeartbeatAt: time.Now().UTC(),
	}
	if err := s.db.WithContext(r.Context()).Create(&provisioner).Error; err != nil {
		fail(w, 500, err.Error())
		return
	}
	s.audit(
		r.Context(),
		"provisioner.registered",
		"provisioner",
		provisioner.ID,
		map[string]string{"name": provisioner.Name},
	)
	respond(w, http.StatusCreated, map[string]string{"id": provisioner.ID})
}

func (s *Server) provisionerHeartbeat(w http.ResponseWriter, r *http.Request) {
	result := s.db.WithContext(r.Context()).Model(&storage.Provisioner{}).
		Where("id = ?", routeParam(r, "id")).
		Updates(map[string]any{"status": "online", "last_heartbeat_at": time.Now().UTC()})
	if result.Error != nil {
		fail(w, 500, result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		fail(w, 404, "provisioner not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) claimJob(w http.ResponseWriter, r *http.Request) {
	provisionerID := routeParam(r, "id")
	var provisioner storage.Provisioner
	if err := s.db.WithContext(r.Context()).
		Where("id = ?", provisionerID).
		First(&provisioner).Error; err != nil {
		fail(w, 404, "provisioner not found")
		return
	}
	var job storage.ProvisionerJob
	var build storage.WorkspaceBuild
	var workspace storage.Workspace
	err := s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("status = ?", "queued").Order("created_at").First(&job).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		result := tx.Model(&job).Where("id = ? AND status = ?", job.ID, "queued").
			Updates(map[string]any{
				"status":      "claimed",
				"claimed_by":  provisionerID,
				"lease_until": now.Add(2 * time.Minute),
				"attempt":     job.Attempt + 1,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("id = ?", job.BuildID).First(&build).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", build.WorkspaceID).First(&workspace).Error; err != nil {
			return err
		}
		result = tx.Model(&build).Updates(map[string]any{
			"status":         domainbuild.Claimed,
			"provisioner_id": provisionerID,
			"started_at":     now,
		})
		if result.Error != nil {
			return result.Error
		}
		build.Status = string(domainbuild.Claimed)
		build.ProvisionerID = provisionerID
		build.StartedAt = &now
		return nil
	})
	if err == gorm.ErrRecordNotFound {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	respond(w, 200, map[string]any{
		"id": job.ID,
		"build": struct {
			storage.WorkspaceBuild
			WorkspaceName string
		}{WorkspaceBuild: build, WorkspaceName: workspace.Name},
	})
}

type jobEventInput struct {
	Type      string         `json:"type"`
	Message   string         `json:"message"`
	Status    string         `json:"status"`
	Resources map[string]any `json:"resources"`
	Error     string         `json:"error"`
}

func (s *Server) buildCredentialSecret(w http.ResponseWriter, r *http.Request) {
	provisionerID := routeParam(r, "id")
	jobID := routeParam(r, "jobID")
	credentialID := routeParam(r, "credentialID")

	var job storage.ProvisionerJob
	err := s.db.WithContext(r.Context()).
		Where("id = ? AND claimed_by = ?", jobID, provisionerID).
		First(&job).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "claimed job not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}

	var build storage.WorkspaceBuild
	if err := s.db.WithContext(r.Context()).
		Where("id = ?", job.BuildID).
		First(&build).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	var snapshot templateSourceInput
	if err := json.Unmarshal(build.SourceSnapshot, &snapshot); err != nil {
		fail(w, http.StatusInternalServerError, "stored source snapshot is invalid")
		return
	}
	if snapshot.CredentialID != credentialID {
		fail(w, http.StatusForbidden, "credential is not authorized for this build")
		return
	}

	var credential storage.Credential
	err = s.db.WithContext(r.Context()).
		Where("id = ? AND organization_id = ?", credentialID, devOrganizationID).
		First(&credential).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "credential not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	secret, err := s.secrets.Read(r.Context(), credential.SecretRef)
	if err != nil {
		fail(w, http.StatusBadGateway, "credential secret could not be read")
		return
	}
	metadata := map[string]string{}
	_ = json.Unmarshal(credential.Metadata, &metadata)
	s.audit(
		r.Context(),
		"credential.read_for_build",
		"credential",
		credentialID,
		map[string]string{"buildId": build.ID, "provisionerId": provisionerID},
	)
	respond(w, http.StatusOK, map[string]any{
		"secret":   secret,
		"kind":     credential.Kind,
		"metadata": metadata,
	})
}

func (s *Server) jobEvent(w http.ResponseWriter, r *http.Request) {
	var input jobEventInput
	if err := decode(r, &input); err != nil {
		fail(w, 400, err.Error())
		return
	}
	var job storage.ProvisionerJob
	err := s.db.WithContext(r.Context()).
		Where(
			"id = ? AND claimed_by = ?",
			routeParam(r, "jobID"),
			routeParam(r, "id"),
		).
		First(&job).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, 404, "claimed job not found")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	var build storage.WorkspaceBuild
	if err := s.db.WithContext(r.Context()).
		Where("id = ?", job.BuildID).
		First(&build).Error; err != nil {
		fail(w, 500, err.Error())
		return
	}
	if input.Status != "" {
		nextStatus, parseErr := domainbuild.ParseStatus(input.Status)
		if parseErr != nil {
			fail(w, http.StatusBadRequest, parseErr.Error())
			return
		}
		if transitionErr := s.builds.CanReport(
			domainbuild.Status(build.Status),
			nextStatus,
		); transitionErr != nil {
			fail(w, http.StatusConflict, transitionErr.Error())
			return
		}
	}
	updates := map[string]any{"logs": build.Logs + input.Message + "\n"}
	if input.Status != "" {
		updates["status"] = input.Status
	}
	if input.Error != "" {
		updates["error_message"] = input.Error
	}
	if input.Resources != nil {
		payload, _ := json.Marshal(input.Resources)
		updates["resource_summary"] = datatypes.JSON(payload)
	}
	if input.Status == string(domainbuild.Running) && build.StartedAt == nil {
		updates["started_at"] = time.Now().UTC()
	}
	terminal := input.Status == string(domainbuild.Succeeded) ||
		input.Status == string(domainbuild.Failed) ||
		input.Status == string(domainbuild.Cancelled)
	if terminal {
		updates["completed_at"] = time.Now().UTC()
	}
	err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if terminal {
			if err := tx.Model(&job).Update("status", input.Status).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&build).Updates(updates).Error; err != nil {
			return err
		}
		if terminal {
			return s.finalizeWorkspaceBuild(
				tx,
				build,
				input.Status,
				input.Resources,
			)
		}
		return nil
	})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) finalizeWorkspaceBuild(
	database *gorm.DB,
	build storage.WorkspaceBuild,
	status string,
	resources map[string]any,
) error {
	operation, err := domainworkspace.ParseBuildOperation(build.Operation)
	if err != nil {
		return err
	}
	observedState := s.workspaceLife.ObservedStateAfter(
		operation,
		status == string(domainbuild.Succeeded),
	)
	if err := database.Model(&storage.Workspace{}).
		Where("id = ?", build.WorkspaceID).
		Update("observed_state", observedState).Error; err != nil {
		return err
	}
	if status != string(domainbuild.Succeeded) || resources == nil {
		return nil
	}
	if err := database.Where("workspace_id = ?", build.WorkspaceID).
		Delete(&storage.WorkspaceResource{}).Error; err != nil {
		return err
	}
	for name, value := range resources {
		if value == nil {
			continue
		}
		summary, err := json.Marshal(map[string]any{"name": name, "value": value})
		if err != nil {
			return err
		}
		resource := storage.WorkspaceResource{
			ID:           id(),
			WorkspaceID:  build.WorkspaceID,
			BuildID:      build.ID,
			ResourceType: "terraform_output",
			ResourceID:   name,
			Summary:      datatypes.JSON(summary),
		}
		if err := database.Create(&resource).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) telemetry(w http.ResponseWriter, r *http.Request) {
	workspaceID := routeParam(r, "workspaceID")
	if err := s.authenticateAgentHost(r, workspaceID); err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	if s.db == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	payload, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	host := storage.AgentHost{
		ID:            id(),
		WorkspaceID:   workspaceID,
		Status:        "online",
		LastTelemetry: datatypes.JSON(payload),
		LastSeenAt:    time.Now().UTC(),
	}
	if err := s.db.WithContext(r.Context()).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "workspace_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"status", "last_telemetry", "last_seen_at"}),
		}).
		Create(&host).Error; err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
