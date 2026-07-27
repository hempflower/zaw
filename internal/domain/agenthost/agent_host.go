package agenthost

type Status string

const (
	Online  Status = "online"
	Offline Status = "offline"
)

type Host struct {
	ID          string
	WorkspaceID string
	Status      Status
}
