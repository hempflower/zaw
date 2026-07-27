package agenthost

import (
	"encoding/json"
	"fmt"
	"mime"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
)

const maxResourceReadBytes = 1 << 20

func (h *Host) resourceList(request rpcRequest) []byte {
	var params struct {
		URI string `json:"uri"`
	}
	if json.Unmarshal(request.Params, &params) != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, "invalid resourceList parameters")
	}
	directory, err := h.workspacePath(params.URI)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodePermissionDenied, err.Error())
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeNotFound, "directory is unavailable")
	}
	items := make([]map[string]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		kind := "file"
		if entry.IsDir() {
			kind = "directory"
		}
		items = append(items, map[string]string{"name": entry.Name(), "type": kind})
	}
	sort.Slice(items, func(left int, right int) bool {
		if items[left]["type"] != items[right]["type"] {
			return items[left]["type"] == "directory"
		}
		return items[left]["name"] < items[right]["name"]
	})
	return rpcResult(request.ID, map[string]any{"entries": items})
}

func (h *Host) resourceRead(request rpcRequest) []byte {
	var params struct {
		URI string `json:"uri"`
	}
	if json.Unmarshal(request.Params, &params) != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, "invalid resourceRead parameters")
	}
	file, err := h.workspacePath(params.URI)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodePermissionDenied, err.Error())
	}
	info, err := os.Stat(file)
	if err != nil || info.IsDir() || info.Size() > maxResourceReadBytes {
		return rpcError(request.ID, ahptypes.ErrorCodeNotFound, "file is unavailable or too large")
	}
	contents, err := os.ReadFile(file)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInternalError, "file cannot be read")
	}
	contentType := mime.TypeByExtension(filepath.Ext(file))
	if contentType == "" {
		contentType = "text/plain"
	}
	return rpcResult(request.ID, map[string]string{
		"data":        string(contents),
		"encoding":    "utf-8",
		"contentType": contentType,
	})
}

func (h *Host) workspaceChanges(request rpcRequest) []byte {
	items := h.refreshWorkingTreeChangeset()
	return rpcResult(request.ID, map[string]any{"items": items})
}

func (h *Host) refreshWorkingTreeChangeset() []map[string]string {
	command := exec.Command("git", "-C", h.workspaceDirectory(), "status", "--porcelain=v1")
	output, err := command.Output()
	if err != nil {
		h.updateWorkingTreeChangeset(nil)
		return []map[string]string{}
	}
	items := make([]map[string]string, 0)
	for _, line := range strings.Split(strings.TrimRight(string(output), "\r\n"), "\n") {
		if len(line) < 4 {
			continue
		}
		items = append(items, map[string]string{
			"status": strings.TrimSpace(line[:2]),
			"path":   line[3:],
		})
	}
	h.updateWorkingTreeChangeset(items)
	return items
}

func (h *Host) updateWorkingTreeChangeset(items []map[string]string) {
	files := make([]ahptypes.ChangesetFile, 0, len(items))
	for _, item := range items {
		path := item["path"]
		resource := (&url.URL{
			Scheme: "file",
			Path:   filepath.Join(h.workspaceDirectory(), path),
		}).String()
		state := json.RawMessage(marshalRaw(map[string]string{
			"uri":     resource,
			"content": "",
		}))
		edit := ahptypes.FileEdit{}
		diff := json.RawMessage(marshalRaw(h.workspaceDiffForPath(path)))
		edit.Diff = &diff
		switch {
		case strings.Contains(item["status"], "D"):
			edit.Before = &state
		case strings.Contains(item["status"], "?"):
			edit.After = &state
		default:
			edit.Before = &state
			edit.After = &state
		}
		files = append(files, ahptypes.ChangesetFile{Id: path, Edit: edit})
	}
	h.emitTypedAction(workingTreeChangesetResource, ahptypes.StateAction{
		Value: &ahptypes.ChangesetContentChangedAction{
			Type:  ahptypes.ActionTypeChangesetContentChanged,
			Files: files,
		},
	}, nil)
}

func (h *Host) workspaceDiff(request rpcRequest) []byte {
	path, err := h.workspaceChangePath(request)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, err.Error())
	}
	return rpcResult(request.ID, map[string]string{"diff": h.workspaceDiffForPath(path)})
}

func (h *Host) workspaceDiffForPath(path string) string {
	if !h.workspacePathIsTracked(path) {
		output, diffErr := exec.Command(
			"git",
			"-C",
			h.workspaceDirectory(),
			"diff",
			"--no-index",
			"--",
			"/dev/null",
			path,
		).CombinedOutput()
		// git diff --no-index returns 1 when it finds a difference.
		if diffErr != nil && len(output) == 0 {
			return ""
		}
		return string(output)
	}
	command := exec.Command("git", "-C", h.workspaceDirectory(), "diff", "--", path)
	output, err := command.Output()
	if err != nil {
		return ""
	}
	return string(output)
}

func (h *Host) workspaceStage(request rpcRequest) []byte {
	path, err := h.workspaceChangePath(request)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, err.Error())
	}
	if err := h.stageWorkspacePath(path); err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInternalError, "change could not be accepted")
	}
	return rpcResult(request.ID, map[string]any{})
}

func (h *Host) stageWorkspacePath(path string) error {
	command := exec.Command("git", "-C", h.workspaceDirectory(), "add", "--", path)
	return command.Run()
}

func (h *Host) workspaceRevert(request rpcRequest) []byte {
	path, err := h.workspaceChangePath(request)
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, err.Error())
	}
	if err := h.revertWorkspacePath(path); err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInternalError, "change could not be restored")
	}
	return rpcResult(request.ID, map[string]any{})
}

func (h *Host) revertWorkspacePath(path string) error {
	if !h.workspacePathIsTracked(path) {
		file := filepath.Join(h.workspaceDirectory(), path)
		info, statErr := os.Lstat(file)
		if statErr != nil || info.IsDir() {
			return fmt.Errorf("untracked change is unavailable")
		}
		if removeErr := os.Remove(file); removeErr != nil {
			return removeErr
		}
		return nil
	}
	command := exec.Command(
		"git",
		"-C",
		h.workspaceDirectory(),
		"restore",
		"--staged",
		"--worktree",
		"--",
		path,
	)
	return command.Run()
}

func (h *Host) invokeChangesetOperation(request rpcRequest) []byte {
	var params ahptypes.InvokeChangesetOperationParams
	if err := json.Unmarshal(request.Params, &params); err != nil ||
		params.Channel != workingTreeChangesetResource || params.Target == nil {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"invalid changeset operation",
		)
	}
	target, ok := params.Target.Value.(*ahptypes.ChangesetOperationResourceTarget)
	if !ok {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"changeset operation requires a resource target",
		)
	}
	path, err := h.workspaceChangePathFromURI(string(target.Resource))
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodePermissionDenied, err.Error())
	}
	h.emitChangesetOperationStatus(
		params.OperationId,
		ahptypes.ChangesetOperationStatusRunning,
		nil,
	)
	switch params.OperationId {
	case "stage":
		err = h.stageWorkspacePath(path)
	case "revert":
		err = h.revertWorkspacePath(path)
	default:
		err = fmt.Errorf("changeset operation is unavailable")
	}
	if err != nil {
		operationError := &ahptypes.ErrorInfo{Message: err.Error()}
		h.emitChangesetOperationStatus(
			params.OperationId,
			ahptypes.ChangesetOperationStatusError,
			operationError,
		)
		return rpcError(request.ID, ahptypes.ErrorCodeInternalError, err.Error())
	}
	h.refreshWorkingTreeChangeset()
	h.emitChangesetOperationStatus(
		params.OperationId,
		ahptypes.ChangesetOperationStatusIdle,
		nil,
	)
	message := ahptypes.NewStringOrMarkdownPlain("Changeset operation completed")
	return rpcResult(request.ID, ahptypes.InvokeChangesetOperationResult{
		Message: &message,
	})
}

func (h *Host) emitChangesetOperationStatus(
	operationID string,
	status ahptypes.ChangesetOperationStatus,
	operationError *ahptypes.ErrorInfo,
) {
	h.emitTypedAction(workingTreeChangesetResource, ahptypes.StateAction{
		Value: &ahptypes.ChangesetOperationStatusChangedAction{
			Type:        ahptypes.ActionTypeChangesetOperationStatusChanged,
			OperationId: operationID,
			Status:      status,
			Error:       operationError,
		},
	}, nil)
}

func (h *Host) workspaceChangePathFromURI(rawURI string) (string, error) {
	parsed, err := url.Parse(rawURI)
	if err != nil || parsed.Scheme != "file" {
		return "", fmt.Errorf("change resource must use file scheme")
	}
	root := filepath.Clean(h.workspaceDirectory())
	target := filepath.Clean(parsed.Path)
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("change resource is outside the workspace")
	}
	return relative, nil
}

func (h *Host) workspacePathIsTracked(path string) bool {
	command := exec.Command(
		"git",
		"-C",
		h.workspaceDirectory(),
		"ls-files",
		"--error-unmatch",
		"--",
		path,
	)
	return command.Run() == nil
}

func (h *Host) workspaceChangePath(request rpcRequest) (string, error) {
	var params struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil || params.Path == "" {
		return "", fmt.Errorf("change path is required")
	}
	clean := filepath.Clean(params.Path)
	if filepath.IsAbs(clean) || clean == ".." ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("change path is outside the workspace")
	}
	return clean, nil
}

func (h *Host) workspacePath(rawURI string) (string, error) {
	parsed, err := url.Parse(rawURI)
	if err != nil || parsed.Scheme != "file" {
		return "", fmt.Errorf("resource URI must use file scheme")
	}
	root, err := filepath.EvalSymlinks(h.workspaceDirectory())
	if err != nil {
		return "", fmt.Errorf("workspace directory is unavailable")
	}
	target, err := filepath.EvalSymlinks(filepath.Clean(parsed.Path))
	if err != nil {
		return "", fmt.Errorf("resource is unavailable")
	}
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("resource is outside the workspace")
	}
	return target, nil
}

func (h *Host) workspaceDirectory() string {
	if h.workDir != "" {
		return h.workDir
	}
	directory, _ := os.Getwd()
	return directory
}

func (h *Host) workspaceURI() string {
	return "file://" + filepath.ToSlash(h.workspaceDirectory())
}
