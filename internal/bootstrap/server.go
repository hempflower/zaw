package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/zaw-dev/zaw/internal/domain"
	"github.com/zaw-dev/zaw/internal/infra/agentidentity"
	"github.com/zaw-dev/zaw/internal/infra/secret/openbao"
	"github.com/zaw-dev/zaw/internal/infra/source"
	httptransport "github.com/zaw-dev/zaw/internal/interfaces/http"
	"go.uber.org/fx"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type ServerConfig struct {
	DSN         string
	Address     string
	MigrateOnly bool
}

type environment struct{}

func NewServerApp(config ServerConfig) *fx.App {
	return fx.New(ServerModule(config))
}

func ServerModule(config ServerConfig) fx.Option {
	return fx.Options(
		fx.Supply(config),
		fx.Provide(loadEnvironment),
		fx.Provide(newDatabase),
		fx.Provide(source.NewResolver),
		fx.Provide(newSecretStore),
		fx.Provide(newAgentHostIdentity),
		fx.Provide(httptransport.NewWithAgentIdentity),
		fx.Invoke(bootstrapServer),
	)
}

func loadEnvironment() (environment, error) {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		return environment{}, fmt.Errorf("load .env: %w", err)
	}
	return environment{}, nil
}

func newSecretStore(environment) domain.SecretStore {
	return openbao.NewClient()
}

func newAgentHostIdentity(environment) (domain.AgentHostIdentity, error) {
	key := os.Getenv("ZAW_AGENT_IDENTITY_SIGNING_KEY")
	if key == "" {
		return nil, fmt.Errorf("ZAW_AGENT_IDENTITY_SIGNING_KEY is required")
	}
	return agentidentity.New(key)
}

func newDatabase(
	_ environment,
	config ServerConfig,
) (*gorm.DB, error) {
	driver := os.Getenv("ZAW_DATABASE_DRIVER")
	if driver == "" {
		driver = "mysql"
	}
	dsn := config.DSN
	if dsn == "" {
		dsn = os.Getenv("ZAW_DATABASE_DSN")
	}
	if dsn == "" && driver == "mysql" {
		dsn = "zaw:zaw@tcp(127.0.0.1:3306)/zaw?parseTime=true&multiStatements=true"
	}
	if dsn == "" && driver == "sqlite" {
		dsn = "./.data/zaw.db"
	}
	switch driver {
	case "mysql":
		return gorm.Open(mysql.Open(dsn), &gorm.Config{})
	case "sqlite":
		return gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	default:
		return nil, fmt.Errorf("unsupported ZAW_DATABASE_DRIVER %q", driver)
	}
}

func bootstrapServer(
	lifecycle fx.Lifecycle,
	shutdowner fx.Shutdowner,
	serverConfig ServerConfig,
	controlPlane *httptransport.Server,
) error {
	if err := controlPlane.Bootstrap(context.Background()); err != nil {
		return err
	}
	if serverConfig.MigrateOnly {
		return nil
	}
	address := serverConfig.Address
	if address == "" {
		address = os.Getenv("ZAW_HTTP_ADDR")
	}
	if address == "" {
		address = ":8080"
	}
	httpServer := &http.Server{
		Addr:              address,
		Handler:           controlPlane.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	var serveDone chan error
	lifecycle.Append(fx.Hook{
		OnStart: func(context.Context) error {
			listener, err := net.Listen("tcp", address)
			if err != nil {
				return fmt.Errorf("listen on %s: %w", address, err)
			}
			serveDone = make(chan error, 1)
			go func() {
				err := httpServer.Serve(listener)
				if errors.Is(err, http.ErrServerClosed) {
					err = nil
				}
				serveDone <- err
				if err != nil {
					slog.Error("HTTP server stopped", "error", err)
					if shutdownErr := shutdowner.Shutdown(); shutdownErr != nil {
						slog.Error("request application shutdown", "error", shutdownErr)
					}
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			controlPlane.CloseAHP()
			if err := httpServer.Shutdown(ctx); err != nil {
				return err
			}
			if serveDone == nil {
				return nil
			}
			select {
			case err := <-serveDone:
				return err
			case <-ctx.Done():
				return fmt.Errorf("stop HTTP server: %w", ctx.Err())
			}
		},
	})
	return nil
}
