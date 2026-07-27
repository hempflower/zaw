package agentidentity

import (
	"strings"
	"testing"
)

func TestRegistrationCredentialIsScopedAndTamperResistant(t *testing.T) {
	service, err := New(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	token, err := service.IssueRegistration("workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	credential, err := service.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	if credential.Kind != "registration" || credential.WorkspaceID != "workspace-1" {
		t.Fatalf("unexpected credential: %#v", credential)
	}
	if _, err := service.Verify(token + "x"); err == nil {
		t.Fatal("tampered credential was accepted")
	}
	again, err := service.IssueRegistration("workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if again != token {
		t.Fatal("registration credential unexpectedly rotated")
	}
}
