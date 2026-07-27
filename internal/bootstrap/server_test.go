package bootstrap

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/zaw-dev/zaw/internal/agenthost"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"github.com/zaw-dev/zaw/internal/provisioner"
	"go.uber.org/fx"
)

func TestNewDatabaseSupportsSQLite(t *testing.T) {
	t.Setenv("ZAW_DATABASE_DRIVER", "sqlite")
	t.Setenv("ZAW_DATABASE_DSN", ":memory:")
	database, err := newDatabase(environment{}, ServerConfig{})
	if err != nil {
		t.Fatalf("create sqlite database: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate sqlite database: %v", err)
	}
}

func TestNewDatabaseSupportsMySQL(t *testing.T) {
	dsn := os.Getenv("ZAW_MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("ZAW_MYSQL_TEST_DSN is not configured")
	}
	t.Setenv("ZAW_DATABASE_DRIVER", "mysql")
	t.Setenv("ZAW_DATABASE_DSN", dsn)
	database, err := newDatabase(environment{}, ServerConfig{})
	if err != nil {
		t.Fatalf("create MySQL database: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate MySQL database: %v", err)
	}
}

func TestApplicationGraphsAreComplete(t *testing.T) {
	tests := map[string]fx.Option{
		"server":      ServerModule(ServerConfig{}),
		"provisioner": ProvisionerModule(provisioner.Config{}),
		"agent host":  AgentHostModule(agenthost.Config{}),
	}
	for name, module := range tests {
		t.Run(name, func(t *testing.T) {
			if err := fx.ValidateApp(module); err != nil {
				t.Fatalf("validate Fx graph: %v", err)
			}
		})
	}
}

func TestServerAppStartsAndStops(t *testing.T) {
	t.Setenv("ZAW_DATABASE_DRIVER", "sqlite")
	t.Setenv("ZAW_DATABASE_DSN", ":memory:")
	t.Setenv(
		"ZAW_AGENT_IDENTITY_SIGNING_KEY",
		"test-agent-identity-signing-key-32-bytes",
	)
	app := fx.New(
		fx.NopLogger,
		ServerModule(ServerConfig{Address: "127.0.0.1:0"}),
	)
	startContext, cancelStart := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelStart()
	if err := app.Start(startContext); err != nil {
		t.Fatalf("start Server app: %v", err)
	}
	stopContext, cancelStop := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelStop()
	if err := app.Stop(stopContext); err != nil {
		t.Fatalf("stop Server app: %v", err)
	}
}

func TestManagedProcessIsCancelledAndJoined(t *testing.T) {
	stopped := make(chan struct{})
	app := fx.New(
		fx.NopLogger,
		fx.Invoke(func(lifecycle fx.Lifecycle, shutdowner fx.Shutdowner) {
			appendManagedProcess(
				lifecycle,
				shutdowner,
				"test process",
				func(ctx context.Context) error {
					<-ctx.Done()
					close(stopped)
					return nil
				},
			)
		}),
	)
	if err := app.Start(context.Background()); err != nil {
		t.Fatalf("start app: %v", err)
	}
	if err := app.Stop(context.Background()); err != nil {
		t.Fatalf("stop app: %v", err)
	}
	select {
	case <-stopped:
	default:
		t.Fatal("managed process was not joined during shutdown")
	}
}
