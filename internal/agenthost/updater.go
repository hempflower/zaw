package agenthost

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultUpdateInterval = 15 * time.Minute
	maxRuntimeSize        = 512 << 20
)

func runAutoUpdater(ctx context.Context, config Config, updated func()) {
	interval := config.UpdateInterval
	if interval <= 0 {
		interval = defaultUpdateInterval
	}
	check := func() bool {
		changed, err := updateRuntime(ctx, config)
		if err != nil && ctx.Err() == nil {
			slog.Warn("Agent Host update check failed", "error", err)
		}
		return changed
	}
	if check() {
		updated()
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if check() {
				updated()
				return
			}
		}
	}
}

func updateRuntime(ctx context.Context, config Config) (bool, error) {
	executable, err := os.Executable()
	if err != nil {
		return false, fmt.Errorf("locate Agent Host runtime: %w", err)
	}
	return updateRuntimeFile(ctx, config, executable)
}

func updateRuntimeFile(ctx context.Context, config Config, executable string) (bool, error) {
	currentDigest, err := fileSHA256(executable)
	if err != nil {
		return false, fmt.Errorf("hash Agent Host runtime: %w", err)
	}
	endpoint, err := agentHostRuntimeEndpoint(config.ServerURL, config.WorkspaceID)
	if err != nil {
		return false, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("If-None-Match", `"sha256:`+currentDigest+`"`)
	response, err := (&http.Client{Timeout: 2 * time.Minute}).Do(request)
	if err != nil {
		return false, fmt.Errorf("download Agent Host update: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotModified {
		return false, nil
	}
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("download Agent Host update: HTTP %d", response.StatusCode)
	}
	if response.Header.Get("X-Zaw-Runtime-GOOS") != runtime.GOOS ||
		response.Header.Get("X-Zaw-Runtime-GOARCH") != runtime.GOARCH {
		return false, fmt.Errorf("control-plane runtime is for a different platform")
	}
	expectedDigest := strings.ToLower(response.Header.Get("X-Zaw-Runtime-SHA256"))
	if len(expectedDigest) != sha256.Size*2 {
		return false, fmt.Errorf("control-plane runtime has no valid SHA-256 digest")
	}
	info, err := os.Stat(executable)
	if err != nil {
		return false, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(executable), ".zaw-update-*")
	if err != nil {
		return false, fmt.Errorf("create Agent Host update: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	hash := sha256.New()
	written, copyErr := io.Copy(
		io.MultiWriter(temporary, hash),
		io.LimitReader(response.Body, maxRuntimeSize+1),
	)
	if copyErr != nil {
		temporary.Close()
		return false, fmt.Errorf("write Agent Host update: %w", copyErr)
	}
	if written > maxRuntimeSize {
		temporary.Close()
		return false, fmt.Errorf("Agent Host update exceeds size limit")
	}
	actualDigest := fmt.Sprintf("%x", hash.Sum(nil))
	if actualDigest != expectedDigest {
		temporary.Close()
		return false, fmt.Errorf("Agent Host update checksum mismatch")
	}
	if err := temporary.Chmod(info.Mode().Perm()); err != nil {
		temporary.Close()
		return false, err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return false, err
	}
	if err := temporary.Close(); err != nil {
		return false, err
	}
	if err := os.Rename(temporaryPath, executable); err != nil {
		return false, fmt.Errorf("install Agent Host update: %w", err)
	}
	slog.Info("Agent Host runtime updated", "sha256", actualDigest)
	return true, nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func agentHostRuntimeEndpoint(serverURL, _ string) (string, error) {
	parsed, err := serverHTTPURL(serverURL)
	if err != nil {
		return "", err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/downloads/zaw/"
	parsed.Path += url.PathEscape(runtime.GOOS) + "/" + url.PathEscape(runtime.GOARCH)
	return parsed.String(), nil
}
