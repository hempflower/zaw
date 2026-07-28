package localfs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/zaw-dev/zaw/internal/domain"
)

const defaultDirectory = ".data/secrets"

type Store struct {
	directory string
}

func New(directory string) (domain.SecretStore, error) {
	if strings.TrimSpace(directory) == "" {
		directory = defaultDirectory
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, fmt.Errorf("resolve local secret directory: %w", err)
	}
	if err := os.MkdirAll(absolute, 0o700); err != nil {
		return nil, fmt.Errorf("create local secret directory: %w", err)
	}
	if err := os.Chmod(absolute, 0o700); err != nil {
		return nil, fmt.Errorf("protect local secret directory: %w", err)
	}
	return &Store{directory: absolute}, nil
}

func (s *Store) Put(ctx context.Context, ref string, values map[string]string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.path(ref)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("encode local secret: %w", err)
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create local secret namespace: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".secret-*")
	if err != nil {
		return fmt.Errorf("create local secret: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect local secret: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write local secret: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync local secret: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close local secret: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace local secret: %w", err)
	}
	return nil
}

func (s *Store) Read(ctx context.Context, ref string) (map[string]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.path(ref)
	if err != nil {
		return nil, err
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read local secret: %w", err)
	}
	var values map[string]string
	if err := json.Unmarshal(payload, &values); err != nil {
		return nil, fmt.Errorf("decode local secret: %w", err)
	}
	return values, nil
}

func (s *Store) Delete(ctx context.Context, ref string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.path(ref)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete local secret: %w", err)
	}
	return nil
}

func (s *Store) path(ref string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(ref)))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid local secret reference")
	}
	return filepath.Join(s.directory, clean+".json"), nil
}
