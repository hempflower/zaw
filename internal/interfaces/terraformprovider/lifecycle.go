package terraformprovider

import (
	"fmt"

	domainworkspace "github.com/zaw-dev/zaw/internal/domain/workspace"
)

const (
	transitionCreate      = "create"
	transitionStart       = "start"
	transitionStop        = "stop"
	transitionReconfigure = "reconfigure"
	transitionRebuild     = "rebuild-from-current-template"
	transitionRepair      = "repair"
	transitionDelete      = "delete"
)

func workspaceDesiredState(transition string) (string, error) {
	operation, err := domainworkspace.ParseBuildOperation(transition)
	if err != nil {
		return "", fmt.Errorf("unsupported Workspace transition %q", transition)
	}
	return string(domainworkspace.DesiredStateForOperation(operation)), nil
}

func workspaceRunning(transition string) (bool, error) {
	desiredState, err := workspaceDesiredState(transition)
	if err != nil {
		return false, err
	}
	if desiredState == "running" {
		return true, nil
	}
	return false, nil
}
