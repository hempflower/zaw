// Package agentidentity signs Workspace-scoped Agent Host registration credentials.
package agentidentity

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zaw-dev/zaw/internal/domain"
)

type Service struct {
	key []byte
}

type claims struct {
	Kind        string `json:"kind"`
	WorkspaceID string `json:"workspaceId"`
}

func New(signingKey string) (*Service, error) {
	if len(strings.TrimSpace(signingKey)) < 32 {
		return nil, fmt.Errorf("agent identity signing key must contain at least 32 characters")
	}
	return &Service{key: []byte(signingKey)}, nil
}

func (s *Service) IssueRegistration(workspaceID string) (string, error) {
	return s.issue(workspaceID)
}

func (s *Service) Verify(token string) (domain.AgentHostCredential, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return domain.AgentHostCredential{}, fmt.Errorf("invalid agent credential")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return domain.AgentHostCredential{}, fmt.Errorf("invalid agent credential")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, s.sign(payload)) {
		return domain.AgentHostCredential{}, fmt.Errorf("invalid agent credential")
	}
	var value claims
	if json.Unmarshal(payload, &value) != nil || value.WorkspaceID == "" ||
		value.Kind != "registration" {
		return domain.AgentHostCredential{}, fmt.Errorf("invalid agent credential")
	}
	return domain.AgentHostCredential{
		Kind:        value.Kind,
		WorkspaceID: value.WorkspaceID,
	}, nil
}

func (s *Service) issue(workspaceID string) (string, error) {
	if workspaceID == "" {
		return "", fmt.Errorf("workspace ID is required")
	}
	payload, err := json.Marshal(claims{
		Kind: "registration", WorkspaceID: workspaceID,
	})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(s.sign(payload)), nil
}

func (s *Service) sign(payload []byte) []byte {
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}
