package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"github.com/zaw-dev/zaw/internal/agenthost"
	"github.com/zaw-dev/zaw/internal/bootstrap"
	"github.com/zaw-dev/zaw/internal/interfaces/terraformprovider"
	"github.com/zaw-dev/zaw/internal/provisioner"
	"github.com/zaw-dev/zaw/internal/version"
)

func main() {
	if strings.HasPrefix(filepath.Base(os.Args[0]), "terraform-provider-zaw") {
		terraformprovider.Serve()
		return
	}
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Fatal(fmt.Errorf("load .env: %w", err))
	}
	if len(os.Args) < 2 {
		log.Fatal("usage: zaw <server|provisioner|agent-host|terraform-provider|version>")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	var err error
	switch os.Args[1] {
	case "server":
		flags := flag.NewFlagSet("server", flag.ExitOnError)
		address := flags.String("address", "", "listen address")
		migrateOnly := flags.Bool("migrate-only", false, "apply migrations then exit")
		_ = flags.Parse(os.Args[2:])
		app := bootstrap.NewServerApp(bootstrap.ServerConfig{
			Address:     *address,
			MigrateOnly: *migrateOnly,
		})
		err = runApp(ctx, app, !*migrateOnly)
	case "provisioner":
		flags := flag.NewFlagSet("provisioner", flag.ExitOnError)
		serverURL := flags.String("server", "", "Server HTTP URL")
		key := flags.String("key", "", "Provisioner connection key")
		name := flags.String("name", "", "Provisioner name")
		workRoot := flags.String("work-root", "", "Provisioner working directory")
		terraformBinary := flags.String("terraform", "", "Terraform executable")
		terraformProviderBinary := flags.String(
			"terraform-provider",
			"",
			"terraform-provider-zaw executable bundled into the local mirror",
		)
		terraformTimeout := flags.Duration("terraform-timeout", 0, "Terraform execution timeout")
		pluginCache := flags.String("terraform-plugin-cache", "", "Terraform plugin cache directory")
		retainFailed := flags.Bool(
			"retain-failed-workdirs",
			false,
			"retain failed build work directories for diagnostics",
		)
		dockerHost := flags.String("docker-host", "", "Docker endpoint for Terraform")
		incusBinary := flags.String(
			"incus-binary",
			"",
			"Incus CLI used for Agent Host credential injection",
		)
		stateDirectory := flags.String("state-dir", "", "Terraform state directory")
		_ = flags.Parse(os.Args[2:])
		app := bootstrap.NewProvisionerApp(provisioner.Config{
			ServerURL:                   *serverURL,
			Key:                         *key,
			Name:                        *name,
			WorkRoot:                    *workRoot,
			TerraformBinary:             *terraformBinary,
			TerraformProviderBinary:     *terraformProviderBinary,
			TerraformTimeout:            *terraformTimeout,
			PluginCacheDir:              *pluginCache,
			RetainFailedWorkDirectories: *retainFailed,
			DockerHost:                  *dockerHost,
			IncusBinary:                 *incusBinary,
			StateDirectory:              *stateDirectory,
		})
		err = runApp(ctx, app, true)
	case "agent-host":
		flags := flag.NewFlagSet("agent-host", flag.ExitOnError)
		serverURL := flags.String("server", "", "Server HTTP or WebSocket URL")
		workspaceID := flags.String("workspace-id", "", "Workspace identifier")
		agentProvider := flags.String("agent-provider", "", "Agent SDK provider")
		copilotCLIPath := flags.String("copilot-cli", "", "GitHub Copilot CLI executable")
		autoUpdate := flags.Bool("auto-update", true, "update the Agent Host from the control plane")
		updateInterval := flags.Duration("update-interval", 0, "Agent Host update check interval")
		workspaceDir := flags.String("workspace-dir", "", "Workspace working directory")
		registrationTokenFile := flags.String(
			"registration-token-file",
			"",
			"Path containing the Agent Host registration credential",
		)
		_ = flags.Parse(os.Args[2:])
		app := bootstrap.NewAgentHostApp(agenthost.Config{
			ServerURL:             *serverURL,
			WorkspaceID:           *workspaceID,
			AgentProvider:         *agentProvider,
			AutoUpdate:            *autoUpdate,
			CopilotCLIPath:        *copilotCLIPath,
			UpdateInterval:        *updateInterval,
			WorkspaceDir:          *workspaceDir,
			RegistrationTokenFile: *registrationTokenFile,
		})
		err = runApp(ctx, app, true)
	case "terraform-provider":
		terraformprovider.Serve()
		return
	case "version":
		fmt.Println(version.Current)
		return
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		log.Fatal(err)
	}
}

type application interface {
	Start(context.Context) error
	Stop(context.Context) error
	Done() <-chan os.Signal
}

func runApp(ctx context.Context, app application, wait bool) error {
	if err := app.Start(ctx); err != nil {
		return err
	}
	if wait {
		select {
		case <-ctx.Done():
		case <-app.Done():
		}
	}
	stopContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return app.Stop(stopContext)
}
