package httptransport

import (
	"context"
	"net/http"
	"testing"

	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeleteTemplateRejectsWorkspaceReferences(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	server := New(database, nil, &memorySecretStore{values: map[string]map[string]string{}})
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	template := storage.Template{
		ID: "template-1", OrganizationID: devOrganizationID, Name: "Ubuntu",
		Description: "", SourceKind: "git", CreatedBy: devUserID,
	}
	if err := database.Create(&template).Error; err != nil {
		t.Fatalf("create template: %v", err)
	}
	if err := database.Create(&storage.TemplateSource{
		ID: "source-1", TemplateID: template.ID, Kind: "git",
		URL: "https://example.test/template.git", RefName: "main",
		CommitSHA: "0123456789012345678901234567890123456789",
	}).Error; err != nil {
		t.Fatalf("create template source: %v", err)
	}

	deleted := request(
		t,
		server.Handler(),
		http.MethodDelete,
		"/api/v1/templates/"+template.ID,
		nil,
	)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d: %s", deleted.Code, deleted.Body.String())
	}
	var remaining int64
	if err := database.Model(&storage.Template{}).Count(&remaining).Error; err != nil {
		t.Fatalf("count templates: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("template remains after deletion: %d", remaining)
	}

	blockedTemplate := storage.Template{
		ID: "template-2", OrganizationID: devOrganizationID, Name: "Pinned",
		Description: "", SourceKind: "git", CreatedBy: devUserID,
	}
	if err := database.Create(&blockedTemplate).Error; err != nil {
		t.Fatalf("create referenced template: %v", err)
	}
	workspace := storage.Workspace{
		ID: "workspace-1", OrganizationID: devOrganizationID, Name: "kept",
		OwnerID: devUserID, TemplateID: blockedTemplate.ID,
		SourceSnapshot:  datatypes.JSON([]byte(`{}`)),
		ParameterValues: datatypes.JSON([]byte(`{}`)),
		DesiredState:    "running", ObservedState: "running",
	}
	if err := database.Create(&workspace).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	blocked := request(
		t,
		server.Handler(),
		http.MethodDelete,
		"/api/v1/templates/"+blockedTemplate.ID,
		nil,
	)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("referenced delete status = %d: %s", blocked.Code, blocked.Body.String())
	}
}
