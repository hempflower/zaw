package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	domainsession "github.com/zaw-dev/zaw/internal/domain/session"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSessionCatalogAPIProvidesPaginationFreshnessAndETag(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(filepath.Join(t.TempDir(), "session-catalog.db")),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatal(err)
	}
	server := New(database, nil, nil)
	repository := storage.NewSessionRepository(database)
	base := time.Date(2026, time.July, 27, 10, 0, 0, 0, time.UTC)
	for index, resource := range []string{"ahp-session:/new", "ahp-session:/old"} {
		modifiedAt := base.Add(time.Duration(1-index) * time.Minute)
		if err := repository.Upsert(context.Background(), domainsession.Summary{
			WorkspaceID:      "workspace-1",
			Resource:         resource,
			Provider:         "copilot",
			Title:            resource,
			Status:           1,
			WorkingDirectory: "file:///workspace",
			CreatedAt:        base.Add(-time.Hour),
			ModifiedAt:       modifiedAt,
			ObservedAt:       base.Add(2 * time.Minute),
		}); err != nil {
			t.Fatal(err)
		}
	}
	first := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		first,
		httptest.NewRequest(http.MethodGet, "/api/v1/sessions?limit=1", nil),
	)
	if first.Code != http.StatusOK {
		t.Fatalf("catalog status = %d: %s", first.Code, first.Body.String())
	}
	var firstPage sessionCatalogResponse
	if err := json.Unmarshal(first.Body.Bytes(), &firstPage); err != nil {
		t.Fatal(err)
	}
	if len(firstPage.Items) != 1 || firstPage.Items[0].Resource != "ahp-session:/new" ||
		!firstPage.Items[0].Stale || firstPage.Items[0].AgentHostOnline ||
		firstPage.NextCursor == "" {
		t.Fatalf("unexpected first page: %+v", firstPage)
	}
	etag := first.Header().Get("ETag")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/sessions?limit=1", nil)
	request.Header.Set("If-None-Match", etag)
	notModified := httptest.NewRecorder()
	server.Handler().ServeHTTP(notModified, request)
	if notModified.Code != http.StatusNotModified {
		t.Fatalf("conditional catalog status = %d", notModified.Code)
	}
	second := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		second,
		httptest.NewRequest(
			http.MethodGet,
			"/api/v1/sessions?limit=1&cursor="+firstPage.NextCursor,
			nil,
		),
	)
	var secondPage sessionCatalogResponse
	if err := json.Unmarshal(second.Body.Bytes(), &secondPage); err != nil {
		t.Fatal(err)
	}
	if len(secondPage.Items) != 1 || secondPage.Items[0].Resource != "ahp-session:/old" {
		t.Fatalf("unexpected second page: %+v", secondPage)
	}
	onlineHost := &ahpHostConnection{}
	server.ahp.register("workspace-1", onlineHost)
	defer server.ahp.unregister("workspace-1", onlineHost)
	online := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		online,
		httptest.NewRequest(http.MethodGet, "/api/v1/sessions?limit=1", nil),
	)
	var onlinePage sessionCatalogResponse
	if err := json.Unmarshal(online.Body.Bytes(), &onlinePage); err != nil {
		t.Fatal(err)
	}
	if !onlinePage.Items[0].AgentHostOnline || onlinePage.Items[0].Stale ||
		online.Header().Get("ETag") == etag {
		t.Fatalf("online state did not affect the projection: %+v", onlinePage)
	}
}

func TestSessionCatalogAPIProjectsMultipleWorkspaces(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(filepath.Join(t.TempDir(), "multi-workspace-catalog.db")),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatal(err)
	}
	repository := storage.NewSessionRepository(database)
	base := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	for index, workspaceID := range []string{"workspace-a", "workspace-b"} {
		if err := repository.Upsert(context.Background(), domainsession.Summary{
			WorkspaceID:      workspaceID,
			Resource:         "ahp-session:/shared-resource",
			Provider:         "copilot",
			Title:            workspaceID,
			Status:           1,
			WorkingDirectory: "file:///workspace",
			CreatedAt:        base,
			ModifiedAt:       base.Add(time.Duration(index) * time.Minute),
			ObservedAt:       base.Add(2 * time.Minute),
		}); err != nil {
			t.Fatal(err)
		}
	}

	server := New(database, nil, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		response,
		httptest.NewRequest(http.MethodGet, "/api/v1/sessions?limit=10", nil),
	)
	if response.Code != http.StatusOK {
		t.Fatalf("catalog status = %d: %s", response.Code, response.Body.String())
	}
	var page sessionCatalogResponse
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 ||
		page.Items[0].WorkspaceID != "workspace-b" ||
		page.Items[1].WorkspaceID != "workspace-a" {
		t.Fatalf("multi-Workspace sessions were not projected independently: %+v", page.Items)
	}
}
