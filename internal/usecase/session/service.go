package session

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	domainsession "github.com/zaw-dev/zaw/internal/domain/session"
)

const (
	defaultPageSize = 50
	maximumPageSize = 200
)

var ErrInvalidCursor = errors.New("invalid cursor")

type Service struct {
	repository domainsession.Repository
}

type Page struct {
	Items      []domainsession.Summary
	NextCursor string
}

func New(repository domainsession.Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) ReplaceWorkspace(
	ctx context.Context,
	workspaceID string,
	items []domainsession.Summary,
) error {
	return s.repository.ReplaceWorkspace(ctx, workspaceID, items)
}

func (s *Service) Upsert(ctx context.Context, item domainsession.Summary) error {
	return s.repository.Upsert(ctx, item)
}

func (s *Service) Remove(ctx context.Context, workspaceID string, resource string) error {
	return s.repository.Remove(ctx, workspaceID, resource)
}

func (s *Service) List(
	ctx context.Context,
	limit int,
	cursor string,
	updatedAfter *time.Time,
) (Page, error) {
	if limit <= 0 {
		limit = defaultPageSize
	}
	if limit > maximumPageSize {
		limit = maximumPageSize
	}
	decoded, err := decodeCursor(cursor)
	if err != nil {
		return Page{}, err
	}
	items, err := s.repository.List(ctx, domainsession.ListQuery{
		Limit:        limit + 1,
		UpdatedAfter: updatedAfter,
		Cursor:       decoded,
	})
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: items}
	if len(page.Items) > limit {
		last := page.Items[limit-1]
		page.Items = page.Items[:limit]
		page.NextCursor = encodeCursor(domainsession.Cursor{
			ModifiedAt:  last.ModifiedAt,
			WorkspaceID: last.WorkspaceID,
			Resource:    last.Resource,
		})
	}
	return page, nil
}

func decodeCursor(value string) (*domainsession.Cursor, error) {
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrInvalidCursor
	}
	var cursor domainsession.Cursor
	if json.Unmarshal(payload, &cursor) != nil || cursor.WorkspaceID == "" ||
		cursor.Resource == "" || cursor.ModifiedAt.IsZero() {
		return nil, ErrInvalidCursor
	}
	return &cursor, nil
}

func encodeCursor(cursor domainsession.Cursor) string {
	payload, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(payload)
}
