package domain

import (
	"context"
	"time"
)

type AgentHostCredential struct {
	Kind        string
	WorkspaceID string
}

// AgentHostIdentity issues deterministic Workspace-scoped credentials without
// retaining their plaintext in the control-plane database or Terraform state.
type AgentHostIdentity interface {
	IssueRegistration(workspaceID string) (string, error)
	Verify(token string) (AgentHostCredential, error)
}

// SecretStore keeps secret payloads outside the business database.
type SecretStore interface {
	Put(context.Context, string, map[string]string) error
	Read(context.Context, string) (map[string]string, error)
	Delete(context.Context, string) error
	Lease(context.Context, string, string, time.Duration) (string, error)
}

// SourceResolver converts mutable source references into immutable snapshots.
type SourceResolver interface {
	ResolveGit(context.Context, string, string, string) (string, error)
	ResolveTar(context.Context, string, string, string) (sha256 string, format string, err error)
}
