package agenthost

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
)

func TestUpdateRuntimeFileInstallsChangedPublicRuntime(t *testing.T) {
	oldRuntime := []byte("old-runtime")
	newRuntime := []byte("new-runtime")
	digest := fmt.Sprintf("%x", sha256.Sum256(newRuntime))
	var authorization, requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		requestPath = r.URL.Path
		w.Header().Set("X-Zaw-Runtime-GOOS", runtime.GOOS)
		w.Header().Set("X-Zaw-Runtime-GOARCH", runtime.GOARCH)
		w.Header().Set("X-Zaw-Runtime-SHA256", digest)
		_, _ = w.Write(newRuntime)
	}))
	defer server.Close()

	directory := t.TempDir()
	executable := directory + "/zaw"
	if err := os.WriteFile(executable, oldRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	changed, err := updateRuntimeFile(context.Background(), Config{
		ServerURL: server.URL, WorkspaceID: "workspace/id",
	}, executable)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected runtime to change")
	}
	contents, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != string(newRuntime) {
		t.Fatalf("runtime = %q", contents)
	}
	if authorization != "" {
		t.Fatalf("Authorization = %q", authorization)
	}
	wantPath := "/downloads/zaw/" + runtime.GOOS + "/" + runtime.GOARCH
	if requestPath != wantPath {
		t.Fatalf("request path = %q, want %q", requestPath, wantPath)
	}
}

func TestUpdateRuntimeFileKeepsCurrentRuntimeOnNotModified(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()
	directory := t.TempDir()
	executable := directory + "/zaw"
	if err := os.WriteFile(executable, []byte("current"), 0o755); err != nil {
		t.Fatal(err)
	}
	changed, err := updateRuntimeFile(context.Background(), Config{
		ServerURL: server.URL, WorkspaceID: "workspace",
	}, executable)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("unchanged runtime was replaced")
	}
}
