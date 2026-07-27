package httptransport

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/zaw-dev/zaw/internal/domain"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/gorm"
)

func (s *Server) agentHostToken(w http.ResponseWriter, r *http.Request) {
	if s.agentIdentity == nil {
		fail(w, http.StatusNotImplemented, "agent identity is not configured")
		return
	}
	provisionerID := routeParam(r, "id")
	jobID := routeParam(r, "jobID")
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
		fail(w, http.StatusInternalServerError, "build is unavailable")
		return
	}
	token, err := s.agentIdentity.IssueRegistration(build.WorkspaceID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "agent credential could not be issued")
		return
	}
	s.audit(
		r.Context(),
		"agent_host.registration_issued",
		"workspace",
		build.WorkspaceID,
		map[string]string{"buildId": build.ID, "provisionerId": provisionerID},
	)
	respond(w, http.StatusOK, map[string]string{"token": token})
}

func (s *Server) authenticateAgentHost(r *http.Request, workspaceID string) error {
	if s.agentIdentity == nil {
		return nil
	}
	credential, err := s.authenticateAgentHostRequest(r)
	if err != nil {
		return err
	}
	if credential.WorkspaceID != workspaceID {
		return fmt.Errorf("agent credential is invalid for this workspace")
	}
	return nil
}

func (s *Server) authenticateAgentHostRequest(
	r *http.Request,
) (domain.AgentHostCredential, error) {
	if s.agentIdentity == nil {
		workspaceID := r.Header.Get("X-Zaw-Test-Workspace-ID")
		if workspaceID == "" {
			return domain.AgentHostCredential{}, fmt.Errorf("agent identity is not configured")
		}
		return domain.AgentHostCredential{Kind: "registration", WorkspaceID: workspaceID}, nil
	}
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return domain.AgentHostCredential{}, fmt.Errorf("agent credential is required")
	}
	credential, err := s.agentIdentity.Verify(parts[1])
	if err != nil {
		return domain.AgentHostCredential{}, fmt.Errorf("agent credential is invalid")
	}
	return credential, nil
}
