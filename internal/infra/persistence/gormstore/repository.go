package gormstore

import (
	"context"

	"gorm.io/gorm"
)

// Repository is the Gorm persistence adapter shared by aggregate-specific
// repositories. It centralizes context propagation, hard deletion, and
// transaction boundaries without exposing Gorm to Domain or Usecase packages.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, value any) error {
	return r.db.WithContext(ctx).Create(value).Error
}

func (r *Repository) First(
	ctx context.Context,
	result any,
	query string,
	args ...any,
) error {
	return r.db.WithContext(ctx).Where(query, args...).First(result).Error
}

func (r *Repository) Save(ctx context.Context, value any) error {
	return r.db.WithContext(ctx).Save(value).Error
}

func (r *Repository) Delete(ctx context.Context, value any) error {
	return r.db.WithContext(ctx).Delete(value).Error
}

func (r *Repository) Transaction(
	ctx context.Context,
	operation func(*Repository) error,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return operation(NewRepository(tx))
	})
}
