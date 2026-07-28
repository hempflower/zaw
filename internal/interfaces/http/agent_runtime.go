package httptransport

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync"
)

var controlPlaneRuntime struct {
	sync.Once
	path   string
	size   int64
	digest string
	err    error
}

func (s *Server) agentHostRuntime(w http.ResponseWriter, r *http.Request) {
	workspaceID := routeParam(r, "workspaceID")
	if err := s.authenticateAgentHost(r, workspaceID); err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	serveRuntimeArtifact(w, r)
}

func (s *Server) agentHostRuntimeDownload(w http.ResponseWriter, r *http.Request) {
	if routeParam(r, "goos") != runtime.GOOS || routeParam(r, "goarch") != runtime.GOARCH {
		http.NotFound(w, r)
		return
	}
	serveRuntimeArtifact(w, r)
}

func serveRuntimeArtifact(w http.ResponseWriter, r *http.Request) {
	path, size, digest, err := runtimeArtifact()
	if err != nil {
		fail(w, http.StatusInternalServerError, "runtime is unavailable")
		return
	}
	etag := `"sha256:` + digest + `"`
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Zaw-Runtime-GOOS", runtime.GOOS)
	w.Header().Set("X-Zaw-Runtime-GOARCH", runtime.GOARCH)
	w.Header().Set("X-Zaw-Runtime-SHA256", digest)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="zaw"`)
	http.ServeFile(w, r, path)
}

func runtimeArtifact() (string, int64, string, error) {
	controlPlaneRuntime.Do(func() {
		path, err := os.Executable()
		if err != nil {
			controlPlaneRuntime.err = err
			return
		}
		file, err := os.Open(path)
		if err != nil {
			controlPlaneRuntime.err = err
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			controlPlaneRuntime.err = err
			return
		}
		hash := sha256.New()
		if _, err := file.WriteTo(hash); err != nil {
			controlPlaneRuntime.err = err
			return
		}
		controlPlaneRuntime.path = path
		controlPlaneRuntime.size = info.Size()
		controlPlaneRuntime.digest = fmt.Sprintf("%x", hash.Sum(nil))
	})
	return controlPlaneRuntime.path, controlPlaneRuntime.size,
		controlPlaneRuntime.digest, controlPlaneRuntime.err
}
