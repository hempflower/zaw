package template

import (
	"fmt"
	"path/filepath"
	"strings"
)

type SourceKind string

const (
	GitSource SourceKind = "git"
	TarSource SourceKind = "tar"
)

type SourceSnapshot struct {
	Kind         SourceKind `json:"kind"`
	URL          string     `json:"url"`
	Ref          string     `json:"ref,omitempty"`
	Commit       string     `json:"commit,omitempty"`
	SHA256       string     `json:"sha256,omitempty"`
	Format       string     `json:"format,omitempty"`
	Directory    string     `json:"directory,omitempty"`
	CredentialID string     `json:"credentialId,omitempty"`
}

func (s SourceSnapshot) ValidateImmutable() error {
	if s.URL == "" {
		return fmt.Errorf("source URL is required")
	}
	if err := validateDirectory(s.Directory); err != nil {
		return err
	}
	switch s.Kind {
	case GitSource:
		if s.Commit == "" {
			return fmt.Errorf("git source snapshot requires a commit")
		}
	case TarSource:
		if s.SHA256 == "" {
			return fmt.Errorf("tar source snapshot requires sha256")
		}
	default:
		return fmt.Errorf("unsupported source kind %q", s.Kind)
	}
	return nil
}

func validateDirectory(directory string) error {
	if directory == "" || directory == "." {
		return nil
	}
	clean := filepath.Clean(directory)
	if filepath.IsAbs(clean) || clean == ".." ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("template directory must stay inside the source")
	}
	return nil
}
