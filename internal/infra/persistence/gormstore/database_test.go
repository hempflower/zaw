package gormstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/datatypes"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSQLiteMigrationAndRepository(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatalf("open SQLite: %v", err)
	}
	verifyDatabaseBehavior(t, database)
}

func TestMySQLMigrationAndRepository(t *testing.T) {
	dsn := os.Getenv("ZAW_MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("ZAW_MYSQL_TEST_DSN is not configured")
	}
	database, err := gorm.Open(
		mysql.Open(dsn),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatalf("open MySQL: %v", err)
	}
	verifyConcurrentMigrations(t, database)
	verifyDatabaseBehavior(t, database)
}

func verifyConcurrentMigrations(t *testing.T, database *gorm.DB) {
	t.Helper()
	const workers = 2
	start := make(chan struct{})
	results := make(chan error, workers)
	for range workers {
		go func() {
			<-start
			results <- Migrate(database)
		}()
	}
	close(start)
	for range workers {
		if err := <-results; err != nil {
			t.Fatalf("concurrent migration: %v", err)
		}
	}
	if database.Migrator().HasTable("null_int64") {
		t.Fatal("migration lock query leaked its scan destination into the schema")
	}
}

func verifyDatabaseBehavior(t *testing.T, database *gorm.DB) {
	t.Helper()
	if err := Migrate(database); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	var migrationCount int64
	if err := database.Model(&SchemaMigration{}).Count(&migrationCount).Error; err != nil {
		t.Fatalf("count applied migrations: %v", err)
	}
	if migrationCount != int64(len(migrations)) {
		t.Fatalf("applied migration count = %d", migrationCount)
	}
	assertNoSoftDeleteColumn(t, database)

	rollback := errors.New("rollback test transaction")
	prefix := fmt.Sprintf("%025d", time.Now().UnixNano())
	credentialID := prefix + "1"
	duplicateID := prefix + "2"
	repository := NewRepository(database)
	err := repository.Transaction(context.Background(), func(transaction *Repository) error {
		credential := Credential{
			ID:             credentialID,
			OrganizationID: prefix + "3",
			Name:           "database-behavior-" + prefix,
			Kind:           "git",
			Metadata:       datatypes.JSON([]byte(`{"username":"zaw"}`)),
			SecretRef:      "test/secret/" + prefix,
			CreatedBy:      prefix + "4",
		}
		if err := transaction.Create(context.Background(), &credential); err != nil {
			return fmt.Errorf("create credential: %w", err)
		}
		var stored Credential
		if err := transaction.First(
			context.Background(),
			&stored,
			"id = ?",
			credentialID,
		); err != nil {
			return fmt.Errorf("read credential: %w", err)
		}
		if stored.CreatedAt.IsZero() || stored.UpdatedAt.IsZero() {
			return fmt.Errorf("automatic timestamps are empty")
		}
		var metadata map[string]string
		if err := json.Unmarshal(stored.Metadata, &metadata); err != nil {
			return fmt.Errorf("decode JSON metadata: %w", err)
		}
		if metadata["username"] != "zaw" {
			return fmt.Errorf("JSON metadata did not round trip: %s", stored.Metadata)
		}
		duplicate := credential
		duplicate.ID = duplicateID
		if err := transaction.Create(context.Background(), &duplicate); err == nil {
			return fmt.Errorf("composite unique index accepted a duplicate")
		}
		if err := transaction.Delete(context.Background(), &credential); err != nil {
			return fmt.Errorf("hard delete credential: %w", err)
		}
		if err := transaction.Create(context.Background(), &duplicate); err != nil {
			return fmt.Errorf("unique key remained after hard delete: %w", err)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("transaction result = %v", err)
	}
	var count int64
	if err := database.Model(&Credential{}).
		Where("id = ?", credentialID).
		Count(&count).Error; err != nil {
		t.Fatalf("count rolled-back credential: %v", err)
	}
	if count != 0 {
		t.Fatalf("transaction rollback retained %d credentials", count)
	}
}

func assertNoSoftDeleteColumn(t *testing.T, database *gorm.DB) {
	t.Helper()
	allModels := append([]any{&SchemaMigration{}}, models...)
	for _, model := range allModels {
		columns, err := database.Migrator().ColumnTypes(model)
		if err != nil {
			t.Fatalf("inspect %T schema: %v", model, err)
		}
		for _, column := range columns {
			if strings.EqualFold(column.Name(), "deleted_at") {
				t.Fatalf("%T unexpectedly contains deleted_at", model)
			}
		}
	}
}
