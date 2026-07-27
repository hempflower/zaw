package build

import "fmt"

type Status string

const (
	Queued    Status = "queued"
	Claimed   Status = "claimed"
	Running   Status = "running"
	Succeeded Status = "succeeded"
	Failed    Status = "failed"
	Cancelled Status = "cancelled"
)

func ParseStatus(value string) (Status, error) {
	status := Status(value)
	switch status {
	case Queued, Claimed, Running, Succeeded, Failed, Cancelled:
		return status, nil
	default:
		return "", fmt.Errorf("unsupported build status %q", value)
	}
}

type Build struct {
	ID          string
	WorkspaceID string
	Operation   string
	Status      Status
}
