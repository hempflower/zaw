package gormstore

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	domainsession "github.com/zaw-dev/zaw/internal/domain/session"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSessionRepositoryReconcilesAndPaginatesSummaries(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(filepath.Join(t.TempDir(), "session-catalog.db")),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(database); err != nil {
		t.Fatal(err)
	}
	assertSessionCatalogIsLightweight(t, database)
	repository := NewSessionRepository(database)
	ctx := context.Background()
	base := time.Date(2026, time.July, 27, 10, 0, 0, 0, time.UTC)
	first := testSessionSummary("workspace-a", "ahp-session:/a", base.Add(time.Minute))
	additions := int64(3)
	first.Activity = "Generating"
	first.Changes = &domainsession.Changes{Additions: &additions}
	second := testSessionSummary("workspace-b", "ahp-session:/b", base)
	removed := testSessionSummary("workspace-a", "ahp-session:/removed", base.Add(-time.Minute))
	if err := repository.ReplaceWorkspace(ctx, "workspace-a", []domainsession.Summary{
		first,
		removed,
	}); err != nil {
		t.Fatal(err)
	}
	if err := repository.Upsert(ctx, second); err != nil {
		t.Fatal(err)
	}
	page, err := repository.List(ctx, domainsession.ListQuery{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 2 || page[0].Resource != first.Resource ||
		page[1].Resource != second.Resource {
		t.Fatalf("unexpected session order: %+v", page)
	}
	if page[0].Activity != first.Activity || page[0].Changes == nil ||
		page[0].Changes.Additions == nil || *page[0].Changes.Additions != additions {
		t.Fatalf("summary details did not round trip: %+v", page[0])
	}
	cursorPage, err := repository.List(ctx, domainsession.ListQuery{
		Limit: 2,
		Cursor: &domainsession.Cursor{
			ModifiedAt:  second.ModifiedAt,
			WorkspaceID: second.WorkspaceID,
			Resource:    second.Resource,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(cursorPage) != 1 || cursorPage[0].Resource != removed.Resource {
		t.Fatalf("unexpected cursor page: %+v", cursorPage)
	}
	if err := repository.ReplaceWorkspace(ctx, "workspace-a", []domainsession.Summary{
		first,
	}); err != nil {
		t.Fatal(err)
	}
	all, err := repository.List(ctx, domainsession.ListQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("reconciliation retained removed sessions: %+v", all)
	}
	updatedAfter := base.Add(30 * time.Second)
	updated, err := repository.List(ctx, domainsession.ListQuery{
		Limit:        10,
		UpdatedAfter: &updatedAfter,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated) != 1 || updated[0].Resource != first.Resource {
		t.Fatalf("unexpected updated_after result: %+v", updated)
	}
}

func assertSessionCatalogIsLightweight(t *testing.T, database *gorm.DB) {
	t.Helper()
	columns, err := database.Migrator().ColumnTypes(&SessionSummary{})
	if err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"workspace_id":      true,
		"resource":          true,
		"provider":          true,
		"title":             true,
		"status":            true,
		"activity":          true,
		"working_directory": true,
		"change_additions":  true,
		"change_deletions":  true,
		"change_files":      true,
		"created_at":        true,
		"modified_at":       true,
		"observed_at":       true,
	}
	for _, column := range columns {
		if !allowed[column.Name()] {
			t.Fatalf("session catalog persists non-summary column %q", column.Name())
		}
	}
}

func testSessionSummary(
	workspaceID string,
	resource string,
	modifiedAt time.Time,
) domainsession.Summary {
	return domainsession.Summary{
		WorkspaceID:      workspaceID,
		Resource:         resource,
		Provider:         "copilot",
		Title:            resource,
		Status:           1,
		WorkingDirectory: "file:///workspace",
		CreatedAt:        modifiedAt.Add(-time.Hour),
		ModifiedAt:       modifiedAt,
		ObservedAt:       modifiedAt.Add(time.Second),
	}
}
