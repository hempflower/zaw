package terraform

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/zaw-dev/zaw/internal/version"
)

const (
	ProviderSource  = "registry.terraform.io/zaw-dev/zaw"
	ProviderVersion = version.Current
)

func InstallBundledProvider(workRoot string, providerBinary string) (string, error) {
	if providerBinary == "" {
		return "", fmt.Errorf("Terraform Provider executable is required")
	}
	providerBinary, err := filepath.Abs(providerBinary)
	if err != nil {
		return "", fmt.Errorf("resolve Terraform Provider executable: %w", err)
	}
	info, err := os.Stat(providerBinary)
	if err != nil {
		return "", fmt.Errorf("inspect Terraform Provider executable: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("Terraform Provider executable is a directory")
	}

	mirrorDirectory := filepath.Join(workRoot, "terraform-provider-mirror")
	packageDirectory := filepath.Join(
		mirrorDirectory,
		ProviderSource,
		ProviderVersion,
		runtime.GOOS+"_"+runtime.GOARCH,
	)
	if err := os.MkdirAll(packageDirectory, 0o700); err != nil {
		return "", fmt.Errorf("create Terraform Provider mirror: %w", err)
	}
	providerPath := filepath.Join(
		packageDirectory,
		"terraform-provider-zaw_v"+ProviderVersion,
	)
	temporaryLink := providerPath + ".tmp"
	_ = os.Remove(temporaryLink)
	if err := os.Symlink(providerBinary, temporaryLink); err != nil {
		return "", fmt.Errorf("link bundled Terraform Provider: %w", err)
	}
	if err := os.Rename(temporaryLink, providerPath); err != nil {
		_ = os.Remove(temporaryLink)
		return "", fmt.Errorf("activate bundled Terraform Provider: %w", err)
	}

	configurationPath := filepath.Join(workRoot, "terraform.tfrc")
	configuration := "provider_installation {\n" +
		"  filesystem_mirror {\n" +
		"    path    = " + strconv.Quote(filepath.ToSlash(mirrorDirectory)) + "\n" +
		"    include = [\"" + ProviderSource + "\"]\n" +
		"  }\n" +
		"  direct {\n" +
		"    exclude = [\"" + ProviderSource + "\"]\n" +
		"  }\n" +
		"}\n"
	if err := os.WriteFile(configurationPath, []byte(configuration), 0o600); err != nil {
		return "", fmt.Errorf("write Terraform CLI configuration: %w", err)
	}
	return configurationPath, nil
}
