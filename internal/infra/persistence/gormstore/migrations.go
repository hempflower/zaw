package gormstore

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

type SchemaMigration struct {
	Version   string `gorm:"primaryKey;size:100"`
	AppliedAt time.Time
}

type migration struct {
	version string
	up      func(*gorm.DB) error
}

var models = []any{
	&Organization{},
	&User{},
	&Membership{},
	&Credential{},
	&Template{},
	&TemplateSource{},
	&TemplateParameter{},
	&Workspace{},
	&WorkspaceBuild{},
	&WorkspaceResource{},
	&Provisioner{},
	&ProvisionerJob{},
	&AgentHost{},
	&SessionSummary{},
	&AuditLog{},
	&LLMProvider{},
	&LLMModel{},
}

var migrations = []migration{
	{
		version: "0001_initial",
		up: func(db *gorm.DB) error {
			return db.AutoMigrate(models...)
		},
	},
	{
		version: "0002_server_managed_models",
		up: func(db *gorm.DB) error {
			return db.AutoMigrate(&Workspace{}, &LLMProvider{}, &LLMModel{})
		},
	},
	{
		version: "0003_session_catalog",
		up: func(db *gorm.DB) error {
			return db.AutoMigrate(&SessionSummary{})
		},
	},
	{
		version: "0004_session_catalog_details",
		up: func(db *gorm.DB) error {
			return db.AutoMigrate(&SessionSummary{})
		},
	},
}

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&SchemaMigration{}); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	for _, current := range migrations {
		var applied int64
		if err := db.Model(&SchemaMigration{}).
			Where("version = ?", current.version).
			Count(&applied).Error; err != nil {
			return fmt.Errorf("read migration %s: %w", current.version, err)
		}
		if applied != 0 {
			continue
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := current.up(tx); err != nil {
				return err
			}
			return tx.Create(&SchemaMigration{
				Version:   current.version,
				AppliedAt: time.Now().UTC(),
			}).Error
		}); err != nil {
			return fmt.Errorf("apply migration %s: %w", current.version, err)
		}
	}
	return nil
}
