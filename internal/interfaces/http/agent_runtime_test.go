package httptransport

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/zaw-dev/zaw/internal/infra/agentidentity"
)

func TestAgentHostRuntimePublishesCurrentPlatformAndDigest(t *testing.T) {
	identity, err := agentidentity.New(strings.Repeat("r", 32))
	if err != nil {
		t.Fatal(err)
	}
	token, err := identity.IssueRegistration("workspace")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodHead, "/api/v1/agent-hosts/workspace/runtime", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	NewWithAgentIdentity(nil, nil, nil, identity).Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("X-Zaw-Runtime-GOOS") != runtime.GOOS ||
		recorder.Header().Get("X-Zaw-Runtime-GOARCH") != runtime.GOARCH {
		t.Fatal("runtime platform headers do not match the control plane")
	}
	if len(recorder.Header().Get("X-Zaw-Runtime-SHA256")) != 64 {
		t.Fatalf("invalid runtime digest %q", recorder.Header().Get("X-Zaw-Runtime-SHA256"))
	}
	unauthorized := httptest.NewRecorder()
	NewWithAgentIdentity(nil, nil, nil, identity).Handler().ServeHTTP(
		unauthorized,
		httptest.NewRequest(http.MethodHead, "/api/v1/agent-hosts/workspace/runtime", nil),
	)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", unauthorized.Code)
	}
}

func TestAgentHostRuntimeDownloadIsPublicAndPlatformScoped(t *testing.T) {
	handler := NewWithAgentIdentity(nil, nil, nil, nil).Handler()
	request := httptest.NewRequest(
		http.MethodHead,
		"/downloads/zaw/"+runtime.GOOS+"/"+runtime.GOARCH,
		nil,
	)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if len(recorder.Header().Get("X-Zaw-Runtime-SHA256")) != 64 {
		t.Fatalf("invalid runtime digest %q", recorder.Header().Get("X-Zaw-Runtime-SHA256"))
	}

	unsupported := httptest.NewRecorder()
	handler.ServeHTTP(
		unsupported,
		httptest.NewRequest(http.MethodHead, "/downloads/zaw/unsupported/unsupported", nil),
	)
	if unsupported.Code != http.StatusNotFound {
		t.Fatalf("unsupported platform status = %d", unsupported.Code)
	}
}
