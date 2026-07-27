package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/zaw-dev/zaw/internal/agenthost"
	"github.com/zaw-dev/zaw/internal/provisioner"
	"go.uber.org/fx"
)

// These role roots are intentionally separate so the Provisioner and Agent Host
// do not construct the control-plane HTTP stack.
func NewProvisionerApp(config provisioner.Config) *fx.App {
	return fx.New(ProvisionerModule(config))
}

func ProvisionerModule(config provisioner.Config) fx.Option {
	return fx.Options(
		fx.Supply(config),
		fx.Invoke(runProvisioner),
	)
}

func runProvisioner(
	lifecycle fx.Lifecycle,
	shutdowner fx.Shutdowner,
	config provisioner.Config,
) {
	appendManagedProcess(
		lifecycle,
		shutdowner,
		"provisioner",
		func(ctx context.Context) error {
			return provisioner.Run(ctx, config)
		},
	)
}

func NewAgentHostApp(config agenthost.Config) *fx.App {
	return fx.New(AgentHostModule(config))
}

func AgentHostModule(config agenthost.Config) fx.Option {
	return fx.Options(
		fx.Supply(config),
		fx.Invoke(runAgentHost),
	)
}

func runAgentHost(
	lifecycle fx.Lifecycle,
	shutdowner fx.Shutdowner,
	config agenthost.Config,
) error {
	if config.WorkspaceID == "" && os.Getenv("ZAW_WORKSPACE_ID") == "" {
		return fmt.Errorf("agent host requires a workspace ID")
	}
	appendManagedProcess(
		lifecycle,
		shutdowner,
		"agent host",
		func(ctx context.Context) error {
			return agenthost.Run(ctx, config)
		},
	)
	return nil
}

func appendManagedProcess(
	lifecycle fx.Lifecycle,
	shutdowner fx.Shutdowner,
	name string,
	run func(context.Context) error,
) {
	var cancel context.CancelFunc
	var done chan error
	lifecycle.Append(fx.Hook{
		OnStart: func(context.Context) error {
			processContext, processCancel := context.WithCancel(context.Background())
			cancel = processCancel
			done = make(chan error, 1)
			go func() {
				err := run(processContext)
				done <- err
				if processContext.Err() == nil {
					if err != nil {
						slog.Error(name+" stopped", "error", err)
					}
					if shutdownErr := shutdowner.Shutdown(); shutdownErr != nil {
						slog.Error("request application shutdown", "error", shutdownErr)
					}
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			if cancel == nil {
				return nil
			}
			cancel()
			select {
			case err := <-done:
				if errors.Is(err, context.Canceled) {
					return nil
				}
				return err
			case <-ctx.Done():
				return fmt.Errorf("stop %s: %w", name, ctx.Err())
			}
		},
	})
}
