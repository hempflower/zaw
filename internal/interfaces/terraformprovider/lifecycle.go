package terraformprovider

import "fmt"

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
	switch transition {
	case transitionStop:
		return "stopped", nil
	case transitionDelete:
		return "deleted", nil
	case transitionCreate, transitionStart, transitionReconfigure,
		transitionRebuild, transitionRepair:
		return "running", nil
	default:
		return "", fmt.Errorf("unsupported Workspace transition %q", transition)
	}
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
