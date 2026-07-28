package httptransport

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type memorySecretStore struct {
	values map[string]map[string]string
}

func (s *memorySecretStore) Put(
	_ context.Context,
	ref string,
	values map[string]string,
) error {
	copy := make(map[string]string, len(values))
	for key, value := range values {
		copy[key] = value
	}
	s.values[ref] = copy
	return nil
}

func (s *memorySecretStore) Read(
	_ context.Context,
	ref string,
) (map[string]string, error) {
	return s.values[ref], nil
}

func (s *memorySecretStore) Delete(_ context.Context, ref string) error {
	delete(s.values, ref)
	return nil
}

func TestCredentialAPINeverReturnsSecretAndKeepsItOnMetadataEdit(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	secrets := &memorySecretStore{values: map[string]map[string]string{}}
	server := New(database, nil, secrets)
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	created := request(t, server.Handler(), http.MethodPost, "/api/v1/credentials", map[string]any{
		"name":     "private-token",
		"kind":     "token",
		"metadata": map[string]string{},
		"secret":   map[string]string{"token": "never-return-this"},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", created.Code, created.Body.String())
	}
	if bytes.Contains(created.Body.Bytes(), []byte("never-return-this")) {
		t.Fatal("credential creation response exposed the secret")
	}
	var credential credentialView
	if err := json.NewDecoder(created.Body).Decode(&credential); err != nil {
		t.Fatalf("decode credential: %v", err)
	}
	stored := secrets.values["zaw/credentials/"+credential.ID]
	if stored["token"] != "never-return-this" {
		t.Fatal("credential secret was not stored in the local secret store")
	}

	updated := request(
		t,
		server.Handler(),
		http.MethodPatch,
		"/api/v1/credentials/"+credential.ID,
		map[string]any{
			"name":     "renamed-token",
			"kind":     "token",
			"metadata": map[string]string{},
		},
	)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d: %s", updated.Code, updated.Body.String())
	}
	if bytes.Contains(updated.Body.Bytes(), []byte("never-return-this")) {
		t.Fatal("credential update response exposed the secret")
	}
	if stored["token"] != "never-return-this" {
		t.Fatal("metadata edit unexpectedly rotated the secret")
	}

	listed := request(t, server.Handler(), http.MethodGet, "/api/v1/credentials", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list status = %d: %s", listed.Code, listed.Body.String())
	}
	if bytes.Contains(listed.Body.Bytes(), []byte("never-return-this")) {
		t.Fatal("credential list response exposed the secret")
	}
}

func TestCredentialDeleteRejectsTemplateAndWorkspaceReferences(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	secrets := &memorySecretStore{values: map[string]map[string]string{}}
	server := New(database, nil, secrets)
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	credential := storage.Credential{
		ID: "credential-1", OrganizationID: devOrganizationID, Name: "private",
		Kind: "token", Metadata: datatypes.JSON([]byte(`{}`)),
		SecretRef: "zaw/credentials/credential-1", CreatedBy: devUserID,
	}
	if err := database.Create(&credential).Error; err != nil {
		t.Fatalf("create credential: %v", err)
	}
	if err := database.Create(&storage.TemplateSource{
		ID: "source-1", TemplateID: "template-1", Kind: "git",
		URL: "https://example.test/template.git", CredentialID: credential.ID,
	}).Error; err != nil {
		t.Fatalf("create template source: %v", err)
	}

	blockedByTemplate := request(
		t,
		server.Handler(),
		http.MethodDelete,
		"/api/v1/credentials/"+credential.ID,
		nil,
	)
	if blockedByTemplate.Code != http.StatusConflict {
		t.Fatalf(
			"template reference delete status = %d: %s",
			blockedByTemplate.Code,
			blockedByTemplate.Body.String(),
		)
	}
	if err := database.Where("template_id = ?", "template-1").
		Delete(&storage.TemplateSource{}).Error; err != nil {
		t.Fatalf("remove template source: %v", err)
	}
	if err := database.Create(&storage.Workspace{
		ID: "workspace-1", OrganizationID: devOrganizationID, Name: "pinned",
		OwnerID: devUserID, TemplateID: "template-1",
		SourceSnapshot:  datatypes.JSON([]byte(`{"credentialId":"credential-1"}`)),
		ParameterValues: datatypes.JSON([]byte(`{}`)),
		DesiredState:    "running", ObservedState: "running",
	}).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	blockedBySnapshot := request(
		t,
		server.Handler(),
		http.MethodDelete,
		"/api/v1/credentials/"+credential.ID,
		nil,
	)
	if blockedBySnapshot.Code != http.StatusConflict {
		t.Fatalf(
			"snapshot reference delete status = %d: %s",
			blockedBySnapshot.Code,
			blockedBySnapshot.Body.String(),
		)
	}
}

func TestCredentialSecretIsRestrictedToClaimedBuildSnapshot(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	secrets := &memorySecretStore{values: map[string]map[string]string{}}
	secrets.values["zaw/credentials/credential-lease"] = map[string]string{"token": "secret"}
	server := New(database, nil, secrets)
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	credential := storage.Credential{
		ID: "credential-lease", OrganizationID: devOrganizationID, Name: "lease",
		Kind: "token", Metadata: datatypes.JSON([]byte(`{}`)),
		SecretRef: "zaw/credentials/credential-lease", CreatedBy: devUserID,
	}
	build := storage.WorkspaceBuild{
		ID: "build-lease", WorkspaceID: "workspace-lease", Operation: "create",
		RequestedBy: devUserID, Status: "claimed",
		SourceSnapshot:    datatypes.JSON([]byte(`{"credentialId":"credential-lease"}`)),
		ParameterSnapshot: datatypes.JSON([]byte(`{}`)),
		ResourceSummary:   datatypes.JSON([]byte(`{}`)),
	}
	job := storage.ProvisionerJob{
		ID: "job-lease", BuildID: build.ID, Status: "claimed", ClaimedBy: "provisioner-1",
	}
	for _, record := range []any{&credential, &build, &job} {
		if err := database.Create(record).Error; err != nil {
			t.Fatalf("create lease fixture: %v", err)
		}
	}
	path := "/api/v1/provisioners/provisioner-1/jobs/job-lease/credentials/"
	authorized := request(t, server.Handler(), http.MethodPost, path+credential.ID+"/secret", nil)
	if authorized.Code != http.StatusOK ||
		!strings.Contains(authorized.Body.String(), `"secret":{"token":"secret"}`) {
		t.Fatalf("authorized secret = %d: %s", authorized.Code, authorized.Body.String())
	}
	forbidden := request(
		t,
		server.Handler(),
		http.MethodPost,
		path+"credential-other/secret",
		nil,
	)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("unauthorized secret = %d: %s", forbidden.Code, forbidden.Body.String())
	}
}

func request(
	t *testing.T,
	handler http.Handler,
	method string,
	path string,
	body any,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatalf("encode request: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
