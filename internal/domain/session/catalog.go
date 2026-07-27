package session

import (
	"context"
	"time"
)

type Summary struct {
	WorkspaceID      string
	Resource         string
	Provider         string
	Title            string
	Status           uint32
	Activity         string
	WorkingDirectory string
	Changes          *Changes
	CreatedAt        time.Time
	ModifiedAt       time.Time
	ObservedAt       time.Time
}

type Changes struct {
	Additions *int64
	Deletions *int64
	Files     *int64
}

type Cursor struct {
	ModifiedAt  time.Time
	WorkspaceID string
	Resource    string
}

type ListQuery struct {
	Limit        int
	UpdatedAfter *time.Time
	Cursor       *Cursor
}

type Repository interface {
	ReplaceWorkspace(context.Context, string, []Summary) error
	Upsert(context.Context, Summary) error
	Remove(context.Context, string, string) error
	List(context.Context, ListQuery) ([]Summary, error)
}
