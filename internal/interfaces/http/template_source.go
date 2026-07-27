package httptransport

import (
	"context"
	"fmt"

	domainTemplate "github.com/zaw-dev/zaw/internal/domain/template"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/gorm"
)

func (s *Server) resolveTemplateSource(
	ctx context.Context,
	input templateSourceInput,
) (templateSourceInput, error) {
	if s.sourceResolver == nil {
		return input, fmt.Errorf("template source resolver is not configured")
	}
	if err := s.validateTemplateCredential(ctx, input); err != nil {
		return input, err
	}
	snapshot := domainTemplate.SourceSnapshot{
		Kind:         domainTemplate.SourceKind(input.Kind),
		URL:          input.URL,
		Ref:          input.Ref,
		Commit:       input.Commit,
		SHA256:       input.SHA256,
		Format:       input.Format,
		Directory:    input.Directory,
		CredentialID: input.CredentialID,
	}
	if input.Kind == string(domainTemplate.GitSource) && snapshot.Commit == "" {
		commit, err := s.sourceResolver.ResolveGit(
			ctx,
			snapshot.URL,
			snapshot.Ref,
			snapshot.CredentialID,
		)
		if err != nil {
			return input, err
		}
		snapshot.Commit = commit
	}
	if input.Kind == string(domainTemplate.TarSource) {
		sha256, format, err := s.sourceResolver.ResolveTar(
			ctx,
			snapshot.URL,
			snapshot.SHA256,
			snapshot.CredentialID,
		)
		if err != nil {
			return input, err
		}
		snapshot.SHA256 = sha256
		if snapshot.Format == "" {
			snapshot.Format = format
		}
	}
	if err := snapshot.ValidateImmutable(); err != nil {
		return input, err
	}
	return templateSourceInput{
		Kind:         string(snapshot.Kind),
		URL:          snapshot.URL,
		Ref:          snapshot.Ref,
		Commit:       snapshot.Commit,
		SHA256:       snapshot.SHA256,
		Format:       snapshot.Format,
		Directory:    snapshot.Directory,
		CredentialID: snapshot.CredentialID,
	}, nil
}

func (s *Server) validateTemplateCredential(
	ctx context.Context,
	input templateSourceInput,
) error {
	if input.CredentialID == "" {
		return nil
	}
	var credential storage.Credential
	err := s.db.WithContext(ctx).
		Where("id = ? AND organization_id = ?", input.CredentialID, devOrganizationID).
		First(&credential).Error
	if err == gorm.ErrRecordNotFound {
		return fmt.Errorf("system credential not found")
	}
	if err != nil {
		return fmt.Errorf("lookup system credential: %w", err)
	}
	if input.Kind == "tar" && credential.Kind == "ssh_key" {
		return fmt.Errorf("ssh key credentials cannot download a Tar URL")
	}
	return nil
}
