package workspace

import (
	"github.com/zaw-dev/zaw/internal/domain/workspace"
)

type Service struct{}

func (Service) NextDesiredState(
	current workspace.Workspace,
	operation workspace.BuildOperation,
) (workspace.DesiredState, error) {
	if err := current.ValidateOperation(operation); err != nil {
		return "", err
	}
	return current.DesiredStateAfter(operation), nil
}

func (Service) ObservedStateAfter(
	operation workspace.BuildOperation,
	succeeded bool,
) workspace.ObservedState {
	if !succeeded {
		return workspace.ObservedFailed
	}
	switch operation {
	case workspace.Stop:
		return workspace.ObservedStopped
	case workspace.Delete:
		return workspace.ObservedDeleted
	default:
		return workspace.ObservedRunning
	}
}
