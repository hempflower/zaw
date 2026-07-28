package httptransport

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type credentialInput struct {
	Name     string            `json:"name"`
	Kind     string            `json:"kind"`
	Metadata map[string]string `json:"metadata"`
	Secret   map[string]string `json:"secret"`
}

type credentialView struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	Metadata  map[string]string `json:"metadata"`
	CreatedAt string            `json:"createdAt"`
	UpdatedAt string            `json:"updatedAt"`
}

func (s *Server) credentials(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listCredentials(w, r)
	case http.MethodPost:
		s.createCredential(w, r)
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) listCredentials(w http.ResponseWriter, r *http.Request) {
	var credentials []storage.Credential
	if err := s.db.WithContext(r.Context()).
		Where("organization_id = ?", devOrganizationID).
		Order("updated_at DESC").
		Find(&credentials).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]credentialView, 0, len(credentials))
	for _, credential := range credentials {
		items = append(items, credentialToView(credential))
	}
	respond(w, http.StatusOK, items)
}

func (s *Server) createCredential(w http.ResponseWriter, r *http.Request) {
	var input credentialInput
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateCredential(input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	credentialID := id()
	secretRef := fmt.Sprintf("zaw/credentials/%s", credentialID)
	if err := s.secrets.Put(r.Context(), secretRef, credentialSecret(input)); err != nil {
		fail(w, http.StatusInternalServerError, fmt.Sprintf("local secret store: %v", err))
		return
	}
	metadata, _ := json.Marshal(input.Metadata)
	credential := storage.Credential{
		ID: credentialID, OrganizationID: devOrganizationID, Name: input.Name,
		Kind: input.Kind, Metadata: datatypes.JSON(metadata), SecretRef: secretRef,
		CreatedBy: devUserID,
	}
	if err := s.db.WithContext(r.Context()).Create(&credential).Error; err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(r.Context(), "credential.created", "credential", credential.ID, map[string]string{
		"kind": credential.Kind,
	})
	respond(w, http.StatusCreated, credentialToView(credential))
}

func (s *Server) credential(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPatch {
		s.updateCredential(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	credentialID := routeParam(r, "id")
	var credential storage.Credential
	err := s.db.WithContext(r.Context()).
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
	if s.credentialIsInUse(r.Context(), credential.ID) {
		fail(
			w,
			http.StatusConflict,
			"credential is referenced by a Template or Workspace source snapshot",
		)
		return
	}
	if err := s.db.WithContext(r.Context()).Delete(&credential).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.secrets.Delete(r.Context(), credential.SecretRef); err != nil {
		s.logger.Warn("credential secret could not be deleted", "credential", credentialID, "error", err)
	}
	s.audit(r.Context(), "credential.deleted", "credential", credentialID, map[string]string{})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) credentialIsInUse(ctx context.Context, credentialID string) bool {
	var currentTemplateSources int64
	if s.db.WithContext(ctx).Model(&storage.TemplateSource{}).
		Where("credential_id = ?", credentialID).
		Count(&currentTemplateSources).Error == nil && currentTemplateSources > 0 {
		return true
	}
	// Source snapshots are immutable JSON, so this portable substring check keeps
	// a credential available for older Workspaces on both SQLite and MySQL.
	var workspaceSnapshots int64
	pattern := `%"credentialId":"` + credentialID + `"%`
	return s.db.WithContext(ctx).Model(&storage.Workspace{}).
		Where("source_snapshot LIKE ?", pattern).
		Count(&workspaceSnapshots).Error == nil && workspaceSnapshots > 0
}

func (s *Server) updateCredential(w http.ResponseWriter, r *http.Request) {
	credentialID := routeParam(r, "id")
	var input credentialInput
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		fail(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := validateCredentialMetadata(input.Kind, input.Metadata); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	var credential storage.Credential
	err := s.db.WithContext(r.Context()).
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
	if input.Kind != credential.Kind && len(input.Secret) == 0 {
		fail(w, http.StatusBadRequest, "changing credential type requires a replacement secret")
		return
	}
	if len(input.Secret) > 0 {
		if err := validateCredential(input); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := s.secrets.Put(
			r.Context(),
			credential.SecretRef,
			credentialSecret(input),
		); err != nil {
			fail(w, http.StatusInternalServerError, "local secret store could not update credential")
			return
		}
	}
	metadata, _ := json.Marshal(input.Metadata)
	credential.Name = input.Name
	credential.Kind = input.Kind
	credential.Metadata = datatypes.JSON(metadata)
	if err := s.db.WithContext(r.Context()).Save(&credential).Error; err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(r.Context(), "credential.updated", "credential", credential.ID, map[string]string{
		"kind": credential.Kind,
	})
	respond(w, http.StatusOK, credentialToView(credential))
}

func validateCredential(input credentialInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if err := validateCredentialMetadata(input.Kind, input.Metadata); err != nil {
		return err
	}
	switch input.Kind {
	case "token":
		if input.Secret["token"] == "" {
			return fmt.Errorf("token is required")
		}
	case "username_password":
		if input.Secret["password"] == "" {
			return fmt.Errorf("username and password are required")
		}
	case "ssh_key":
		if input.Secret["privateKey"] == "" {
			return fmt.Errorf("ssh key metadata and private key are required")
		}
	default:
		return fmt.Errorf("unsupported credential kind")
	}
	return nil
}

func validateCredentialMetadata(kind string, metadata map[string]string) error {
	switch kind {
	case "token":
		return nil
	case "username_password":
		if metadata["username"] == "" {
			return fmt.Errorf("username is required")
		}
	case "ssh_key":
		if metadata["username"] == "" || metadata["publicKey"] == "" ||
			metadata["fingerprint"] == "" {
			return fmt.Errorf("ssh key metadata is incomplete")
		}
	default:
		return fmt.Errorf("unsupported credential kind")
	}
	return nil
}

func credentialSecret(input credentialInput) map[string]string {
	secret := make(map[string]string, len(input.Secret)+3)
	for key, value := range input.Secret {
		secret[key] = value
	}
	secret["_zaw_kind"] = input.Kind
	for key, value := range input.Metadata {
		secret["_zaw_metadata_"+key] = value
	}
	return secret
}

func credentialToView(credential storage.Credential) credentialView {
	metadata := map[string]string{}
	_ = json.Unmarshal(credential.Metadata, &metadata)
	return credentialView{
		ID: credential.ID, Name: credential.Name, Kind: credential.Kind, Metadata: metadata,
		CreatedAt: credential.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: credential.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}
