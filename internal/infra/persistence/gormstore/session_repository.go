package gormstore

import (
	"context"

	domainsession "github.com/zaw-dev/zaw/internal/domain/session"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SessionRepository struct {
	db *gorm.DB
}

func NewSessionRepository(db *gorm.DB) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) ReplaceWorkspace(
	ctx context.Context,
	workspaceID string,
	items []domainsession.Summary,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		models := make([]SessionSummary, 0, len(items))
		resources := make([]string, 0, len(items))
		for _, item := range items {
			models = append(models, sessionSummaryModel(item))
			resources = append(resources, item.Resource)
		}
		if len(models) != 0 {
			if err := tx.Clauses(sessionSummaryUpsert()).Create(&models).Error; err != nil {
				return err
			}
		}
		query := tx.Where("workspace_id = ?", workspaceID)
		if len(resources) != 0 {
			query = query.Where("resource NOT IN ?", resources)
		}
		return query.Delete(&SessionSummary{}).Error
	})
}

func (r *SessionRepository) Upsert(
	ctx context.Context,
	item domainsession.Summary,
) error {
	model := sessionSummaryModel(item)
	return r.db.WithContext(ctx).
		Clauses(sessionSummaryUpsert()).
		Create(&model).Error
}

func (r *SessionRepository) Remove(
	ctx context.Context,
	workspaceID string,
	resource string,
) error {
	return r.db.WithContext(ctx).
		Where("workspace_id = ? AND resource = ?", workspaceID, resource).
		Delete(&SessionSummary{}).Error
}

func (r *SessionRepository) List(
	ctx context.Context,
	query domainsession.ListQuery,
) ([]domainsession.Summary, error) {
	database := r.db.WithContext(ctx).Model(&SessionSummary{})
	if query.UpdatedAfter != nil {
		database = database.Where("modified_at > ?", *query.UpdatedAfter)
	}
	if query.Cursor != nil {
		database = database.Where(
			"modified_at < ? OR (modified_at = ? AND workspace_id > ?) OR "+
				"(modified_at = ? AND workspace_id = ? AND resource > ?)",
			query.Cursor.ModifiedAt,
			query.Cursor.ModifiedAt,
			query.Cursor.WorkspaceID,
			query.Cursor.ModifiedAt,
			query.Cursor.WorkspaceID,
			query.Cursor.Resource,
		)
	}
	var models []SessionSummary
	err := database.
		Order("modified_at DESC").
		Order("workspace_id ASC").
		Order("resource ASC").
		Limit(query.Limit).
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	items := make([]domainsession.Summary, 0, len(models))
	for _, model := range models {
		items = append(items, domainSessionSummary(model))
	}
	return items, nil
}

func sessionSummaryUpsert() clause.OnConflict {
	return clause.OnConflict{
		Columns: []clause.Column{{Name: "workspace_id"}, {Name: "resource"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"provider",
			"title",
			"status",
			"activity",
			"working_directory",
			"change_additions",
			"change_deletions",
			"change_files",
			"created_at",
			"modified_at",
			"observed_at",
		}),
	}
}

func sessionSummaryModel(item domainsession.Summary) SessionSummary {
	model := SessionSummary{
		WorkspaceID:      item.WorkspaceID,
		Resource:         item.Resource,
		Provider:         item.Provider,
		Title:            item.Title,
		Status:           item.Status,
		Activity:         item.Activity,
		WorkingDirectory: item.WorkingDirectory,
		CreatedAt:        item.CreatedAt,
		ModifiedAt:       item.ModifiedAt,
		ObservedAt:       item.ObservedAt,
	}
	if item.Changes != nil {
		model.ChangeAdditions = item.Changes.Additions
		model.ChangeDeletions = item.Changes.Deletions
		model.ChangeFiles = item.Changes.Files
	}
	return model
}

func domainSessionSummary(model SessionSummary) domainsession.Summary {
	item := domainsession.Summary{
		WorkspaceID:      model.WorkspaceID,
		Resource:         model.Resource,
		Provider:         model.Provider,
		Title:            model.Title,
		Status:           model.Status,
		Activity:         model.Activity,
		WorkingDirectory: model.WorkingDirectory,
		CreatedAt:        model.CreatedAt,
		ModifiedAt:       model.ModifiedAt,
		ObservedAt:       model.ObservedAt,
	}
	if model.ChangeAdditions != nil || model.ChangeDeletions != nil ||
		model.ChangeFiles != nil {
		item.Changes = &domainsession.Changes{
			Additions: model.ChangeAdditions,
			Deletions: model.ChangeDeletions,
			Files:     model.ChangeFiles,
		}
	}
	return item
}

var _ domainsession.Repository = (*SessionRepository)(nil)
