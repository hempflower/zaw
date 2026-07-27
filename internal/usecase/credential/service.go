package credential

import (
	"context"
	"fmt"
	"time"

	"github.com/zaw-dev/zaw/internal/domain"
	domainCredential "github.com/zaw-dev/zaw/internal/domain/credential"
)

type Service struct{ Secrets domain.SecretStore }

func (s Service) Create(
	ctx context.Context,
	credentialID string,
	kind domainCredential.Kind,
	metadata domainCredential.Metadata,
	secret map[string]string,
) (string, error) {
	if err := metadata.Validate(kind); err != nil {
		return "", err
	}
	if len(secret) == 0 {
		return "", fmt.Errorf("secret is required")
	}
	secretRef := "zaw/credentials/" + credentialID
	if err := s.Secrets.Put(ctx, secretRef, secret); err != nil {
		return "", err
	}
	return secretRef, nil
}

func (s Service) LeaseForBuild(
	ctx context.Context,
	secretRef string,
	buildID string,
) (string, error) {
	return s.Secrets.Lease(ctx, secretRef, buildID, 10*time.Minute)
}
