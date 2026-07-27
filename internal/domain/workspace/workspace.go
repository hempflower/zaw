package workspace

import "fmt"

type DesiredState string
type ObservedState string
type BuildOperation string

const (
	DesiredRunning DesiredState = "running"
	DesiredStopped DesiredState = "stopped"
	DesiredDeleted DesiredState = "deleted"

	ObservedPending      ObservedState = "pending"
	ObservedProvisioning ObservedState = "provisioning"
	ObservedRunning      ObservedState = "running"
	ObservedStopping     ObservedState = "stopping"
	ObservedStopped      ObservedState = "stopped"
	ObservedDeleting     ObservedState = "deleting"
	ObservedDeleted      ObservedState = "deleted"
	ObservedFailed       ObservedState = "failed"
	ObservedDegraded     ObservedState = "degraded"

	Create                     BuildOperation = "create"
	Start                      BuildOperation = "start"
	Stop                       BuildOperation = "stop"
	Reconfigure                BuildOperation = "reconfigure"
	RebuildFromCurrentTemplate BuildOperation = "rebuild-from-current-template"
	Repair                     BuildOperation = "repair"
	Delete                     BuildOperation = "delete"
)

func ParseBuildOperation(value string) (BuildOperation, error) {
	operation := BuildOperation(value)
	switch operation {
	case Create, Start, Stop, Reconfigure, RebuildFromCurrentTemplate, Repair, Delete:
		return operation, nil
	default:
		return "", fmt.Errorf("unsupported build operation %q", value)
	}
}

type Workspace struct {
	ID             string
	OrganizationID string
	TemplateID     string
	DesiredState   DesiredState
	ObservedState  ObservedState
}

func (w Workspace) ValidateOperation(operation BuildOperation) error {
	if w.DesiredState == DesiredDeleted {
		return fmt.Errorf("deleted workspace cannot accept builds")
	}
	switch operation {
	case Delete:
		return nil
	case Stop:
		if w.DesiredState == DesiredRunning {
			return nil
		}
	case Start:
		if w.DesiredState == DesiredStopped {
			return nil
		}
	case Reconfigure, RebuildFromCurrentTemplate, Repair:
		if w.DesiredState == DesiredRunning || w.DesiredState == DesiredStopped {
			return nil
		}
	}
	return fmt.Errorf("operation %q is invalid from desired state %q", operation, w.DesiredState)
}

func (w Workspace) DesiredStateAfter(operation BuildOperation) DesiredState {
	switch operation {
	case Stop:
		return DesiredStopped
	case Delete:
		return DesiredDeleted
	case Start, RebuildFromCurrentTemplate:
		return DesiredRunning
	default:
		return w.DesiredState
	}
}
