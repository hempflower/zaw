package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type templateSourceInput struct {
	Kind         string `json:"kind"`
	URL          string `json:"url"`
	Ref          string `json:"ref,omitempty"`
	Commit       string `json:"commit,omitempty"`
	SHA256       string `json:"sha256,omitempty"`
	Format       string `json:"format,omitempty"`
	Directory    string `json:"directory,omitempty"`
	CredentialID string `json:"credentialId,omitempty"`
}

type templateInput struct {
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Source      templateSourceInput `json:"source"`
}

type templateView struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Source      templateSourceInput `json:"source"`
	CreatedAt   string              `json:"createdAt"`
	UpdatedAt   string              `json:"updatedAt"`
}

func (s *Server) templates(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listTemplates(w, r)
	case http.MethodPost:
		s.createTemplate(w, r)
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) listTemplates(w http.ResponseWriter, r *http.Request) {
	var templates []storage.Template
	if err := s.db.WithContext(r.Context()).
		Where("organization_id = ?", devOrganizationID).
		Order("updated_at DESC").
		Find(&templates).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]templateView, 0, len(templates))
	for _, item := range templates {
		var source storage.TemplateSource
		if err := s.db.WithContext(r.Context()).
			Where("template_id = ?", item.ID).
			First(&source).Error; err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, templateToView(item, source))
	}
	respond(w, http.StatusOK, items)
}

func (s *Server) createTemplate(w http.ResponseWriter, r *http.Request) {
	var input templateInput
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateTemplateInput(input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	source, err := s.resolveTemplateSource(r.Context(), input.Source)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	template := storage.Template{
		ID: id(), OrganizationID: devOrganizationID, Name: input.Name,
		Description: input.Description, SourceKind: source.Kind, CreatedBy: devUserID,
	}
	err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&template).Error; err != nil {
			return err
		}
		return tx.Create(&storage.TemplateSource{
			ID: id(), TemplateID: template.ID, Kind: source.Kind, URL: source.URL,
			RefName: source.Ref, CommitSHA: source.Commit, SHA256: source.SHA256,
			ArchiveFormat: source.Format, Directory: source.Directory,
			CredentialID: source.CredentialID,
		}).Error
	})
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(r.Context(), "template.created", "template", template.ID, map[string]string{
		"sourceKind": source.Kind,
	})
	respond(w, http.StatusCreated, templateView{
		ID: template.ID, Name: template.Name, Description: template.Description,
		Source: source,
	})
}

func (s *Server) template(w http.ResponseWriter, r *http.Request) {
	templateID := routeParam(r, "id")
	switch r.Method {
	case http.MethodPatch:
		s.updateTemplate(w, r, templateID)
		return
	case http.MethodDelete:
		s.deleteTemplate(w, r, templateID)
		return
	case http.MethodGet:
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var template storage.Template
	err := s.db.WithContext(r.Context()).
		Where("id = ? AND organization_id = ?", templateID, devOrganizationID).
		First(&template).Error
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	var source storage.TemplateSource
	if err := s.db.WithContext(r.Context()).
		Where("template_id = ?", template.ID).
		First(&source).Error; err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, templateToView(template, source))
}

func (s *Server) updateTemplate(
	w http.ResponseWriter,
	r *http.Request,
	templateID string,
) {
	var input templateInput
	if err := decode(r, &input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateTemplateInput(input); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	source, err := s.resolveTemplateSource(r.Context(), input.Source)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&storage.Template{}).
			Where("id = ? AND organization_id = ?", templateID, devOrganizationID).
			Updates(map[string]any{
				"name": input.Name, "description": input.Description,
				"source_kind": source.Kind,
			})
		if result.Error != nil || result.RowsAffected == 0 {
			if result.Error != nil {
				return result.Error
			}
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("template_id = ?", templateID).
			Delete(&storage.TemplateSource{}).Error; err != nil {
			return err
		}
		return tx.Create(&storage.TemplateSource{
			ID: id(), TemplateID: templateID, Kind: source.Kind, URL: source.URL,
			RefName: source.Ref, CommitSHA: source.Commit, SHA256: source.SHA256,
			ArchiveFormat: source.Format, Directory: source.Directory,
			CredentialID: source.CredentialID,
		}).Error
	})
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(r.Context(), "template.updated", "template", templateID, map[string]string{
		"sourceKind": source.Kind,
	})
	respond(w, http.StatusOK, map[string]string{"id": templateID})
}

func (s *Server) deleteTemplate(
	w http.ResponseWriter,
	r *http.Request,
	templateID string,
) {
	err := s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var workspaceCount int64
		if err := tx.Model(&storage.Workspace{}).
			Where("template_id = ? AND organization_id = ?", templateID, devOrganizationID).
			Count(&workspaceCount).Error; err != nil {
			return err
		}
		if workspaceCount > 0 {
			return fmt.Errorf("template is used by existing workspaces")
		}
		result := tx.Where("id = ? AND organization_id = ?", templateID, devOrganizationID).
			Delete(&storage.Template{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Where("template_id = ?", templateID).
			Delete(&storage.TemplateSource{}).Error
	})
	if err == gorm.ErrRecordNotFound {
		fail(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(r.Context(), "template.deleted", "template", templateID, map[string]string{})
	w.WriteHeader(http.StatusNoContent)
}

func validateTemplateInput(input templateInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if input.Source.Kind != "git" && input.Source.Kind != "tar" {
		return fmt.Errorf("source.kind must be git or tar")
	}
	if strings.TrimSpace(input.Source.URL) == "" {
		return fmt.Errorf("source.url is required")
	}
	if input.Source.Kind == "git" && input.Source.Ref == "" && input.Source.Commit == "" {
		return fmt.Errorf("git source requires ref or commit")
	}
	return nil
}

func sourceJSON(source templateSourceInput) datatypes.JSON {
	b, _ := json.Marshal(source)
	return b
}

func templateToView(template storage.Template, source storage.TemplateSource) templateView {
	return templateView{
		ID: template.ID, Name: template.Name, Description: template.Description,
		Source: templateSourceInput{Kind: source.Kind, URL: source.URL,
			Ref: source.RefName, Commit: source.CommitSHA, SHA256: source.SHA256,
			Format: source.ArchiveFormat, Directory: source.Directory,
			CredentialID: source.CredentialID},
		CreatedAt: template.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: template.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}
