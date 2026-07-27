package template

import (
	"context"
	"fmt"

	"github.com/zaw-dev/zaw/internal/domain"
	domainTemplate "github.com/zaw-dev/zaw/internal/domain/template"
)

type CreateInput struct {
	OrganizationID string
	CredentialID   string
	Source         domainTemplate.SourceSnapshot
}

type Service struct{ Sources domain.SourceResolver }

func (s Service) ResolveSnapshot(
	ctx context.Context,
	input CreateInput,
) (domainTemplate.SourceSnapshot, error) {
	snapshot := input.Source
	snapshot.CredentialID = input.CredentialID
	switch snapshot.Kind {
	case domainTemplate.GitSource:
		if snapshot.Commit == "" {
			commit, err := s.Sources.ResolveGit(ctx, snapshot.URL, snapshot.Ref, input.CredentialID)
			if err != nil {
				return snapshot, err
			}
			snapshot.Commit = commit
		}
	case domainTemplate.TarSource:
		sha256, format, err := s.Sources.ResolveTar(
			ctx,
			snapshot.URL,
			snapshot.SHA256,
			input.CredentialID,
		)
		if err != nil {
			return snapshot, err
		}
		snapshot.SHA256 = sha256
		if snapshot.Format == "" {
			snapshot.Format = format
		}
	default:
		return snapshot, fmt.Errorf("unsupported template source kind")
	}
	return snapshot, snapshot.ValidateImmutable()
}
