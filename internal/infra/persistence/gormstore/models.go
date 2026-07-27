package gormstore

import (
	"time"

	"gorm.io/datatypes"
)

type Organization struct {
	ID        string `gorm:"primaryKey;size:26"`
	Name      string `gorm:"size:200;not null"`
	CreatedAt time.Time
}

type User struct {
	ID          string `gorm:"primaryKey;size:26"`
	Email       string `gorm:"size:320;not null;uniqueIndex"`
	DisplayName string `gorm:"size:200;not null"`
	CreatedAt   time.Time
}

type Membership struct {
	OrganizationID string `gorm:"primaryKey;size:26"`
	UserID         string `gorm:"primaryKey;size:26"`
	Role           string `gorm:"size:20;not null"`
}

type Credential struct {
	ID             string         `gorm:"primaryKey;size:26"`
	OrganizationID string         `gorm:"size:26;not null;uniqueIndex:credential_name"`
	Name           string         `gorm:"size:200;not null;uniqueIndex:credential_name"`
	Kind           string         `gorm:"size:32;not null"`
	Metadata       datatypes.JSON `gorm:"not null"`
	SecretRef      string         `gorm:"size:512;not null"`
	CreatedBy      string         `gorm:"size:26;not null"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Template struct {
	ID             string `gorm:"primaryKey;size:26"`
	OrganizationID string `gorm:"size:26;not null;uniqueIndex:template_name"`
	Name           string `gorm:"size:200;not null;uniqueIndex:template_name"`
	Description    string `gorm:"type:text;not null"`
	SourceKind     string `gorm:"size:10;not null"`
	CreatedBy      string `gorm:"size:26;not null"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type TemplateSource struct {
	ID            string `gorm:"primaryKey;size:26"`
	TemplateID    string `gorm:"size:26;not null;uniqueIndex"`
	Kind          string `gorm:"size:10;not null"`
	URL           string `gorm:"type:text;not null"`
	RefName       string `gorm:"size:255"`
	CommitSHA     string `gorm:"size:128"`
	SHA256        string `gorm:"size:64"`
	ArchiveFormat string `gorm:"size:16"`
	Directory     string `gorm:"size:1024"`
	CredentialID  string `gorm:"size:26"`
	CreatedAt     time.Time
}

type TemplateParameter struct {
	ID         string         `gorm:"primaryKey;size:26"`
	TemplateID string         `gorm:"size:26;not null;uniqueIndex:template_parameter"`
	Name       string         `gorm:"size:200;not null;uniqueIndex:template_parameter"`
	Definition datatypes.JSON `gorm:"not null"`
}

type Workspace struct {
	ID              string         `gorm:"primaryKey;size:26"`
	OrganizationID  string         `gorm:"size:26;not null;uniqueIndex:workspace_name"`
	Name            string         `gorm:"size:200;not null;uniqueIndex:workspace_name"`
	OwnerID         string         `gorm:"size:26;not null"`
	TemplateID      string         `gorm:"size:26;not null"`
	SourceSnapshot  datatypes.JSON `gorm:"not null"`
	ParameterValues datatypes.JSON `gorm:"not null"`
	DesiredState    string         `gorm:"size:20;not null"`
	ObservedState   string         `gorm:"size:20;not null"`
	CurrentBuildID  string         `gorm:"size:26"`
	ModelID         string         `gorm:"size:26;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type LLMProvider struct {
	ID             string `gorm:"primaryKey;size:26"`
	OrganizationID string `gorm:"size:26;not null;uniqueIndex:llm_provider_name"`
	Name           string `gorm:"size:200;not null;uniqueIndex:llm_provider_name"`
	Kind           string `gorm:"size:20;not null"`
	APIBase        string `gorm:"size:2048;not null"`
	SecretRef      string `gorm:"size:512;not null"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type LLMModel struct {
	ID            string         `gorm:"primaryKey;size:26"`
	ProviderID    string         `gorm:"size:26;not null;uniqueIndex:llm_model_name"`
	Name          string         `gorm:"size:200;not null;uniqueIndex:llm_model_name"`
	UpstreamModel string         `gorm:"size:300;not null"`
	IsDefault     bool           `gorm:"not null;index"`
	Capabilities  datatypes.JSON `gorm:"not null"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type WorkspaceBuild struct {
	ID                string         `gorm:"primaryKey;size:26"`
	WorkspaceID       string         `gorm:"size:26;not null;index"`
	Operation         string         `gorm:"size:40;not null"`
	RequestedBy       string         `gorm:"size:26;not null"`
	SourceSnapshot    datatypes.JSON `gorm:"not null"`
	ParameterSnapshot datatypes.JSON `gorm:"not null"`
	Status            string         `gorm:"size:20;not null"`
	ProvisionerID     string         `gorm:"size:26"`
	Logs              string         `gorm:"type:mediumtext;not null"`
	ResourceSummary   datatypes.JSON `gorm:"not null"`
	ErrorMessage      string         `gorm:"type:text"`
	CreatedAt         time.Time
	StartedAt         *time.Time
	CompletedAt       *time.Time
}

type WorkspaceResource struct {
	ID           string         `gorm:"primaryKey;size:26"`
	WorkspaceID  string         `gorm:"size:26;not null;index"`
	BuildID      string         `gorm:"size:26;not null;index"`
	ResourceType string         `gorm:"size:200;not null"`
	ResourceID   string         `gorm:"size:512;not null"`
	Summary      datatypes.JSON `gorm:"not null"`
}

type Provisioner struct {
	ID              string         `gorm:"primaryKey;size:26"`
	Name            string         `gorm:"size:200;not null"`
	Capabilities    datatypes.JSON `gorm:"not null"`
	Status          string         `gorm:"size:20;not null"`
	LastHeartbeatAt time.Time      `gorm:"not null"`
	CreatedAt       time.Time
}

type ProvisionerJob struct {
	ID         string `gorm:"primaryKey;size:26"`
	BuildID    string `gorm:"size:26;not null;uniqueIndex"`
	Status     string `gorm:"size:20;not null"`
	ClaimedBy  string `gorm:"size:26"`
	LeaseUntil *time.Time
	Attempt    int `gorm:"not null"`
	CreatedAt  time.Time
}

type AgentHost struct {
	ID            string         `gorm:"primaryKey;size:26"`
	WorkspaceID   string         `gorm:"size:26;not null;uniqueIndex"`
	Status        string         `gorm:"size:20;not null"`
	LastTelemetry datatypes.JSON `gorm:"not null"`
	LastSeenAt    time.Time      `gorm:"not null"`
}

// SessionSummary is a lightweight, query-oriented projection of the AHP
// session catalog. Full session, chat, terminal, and changeset state remains
// owned by the Agent Host.
type SessionSummary struct {
	WorkspaceID      string `gorm:"primaryKey;size:26"`
	Resource         string `gorm:"primaryKey;size:700"`
	Provider         string `gorm:"size:200;not null"`
	Title            string `gorm:"size:500;not null"`
	Status           uint32 `gorm:"not null"`
	Activity         string `gorm:"size:1000"`
	WorkingDirectory string `gorm:"size:2048"`
	ChangeAdditions  *int64
	ChangeDeletions  *int64
	ChangeFiles      *int64
	CreatedAt        time.Time `gorm:"not null"`
	ModifiedAt       time.Time `gorm:"not null;index:session_catalog_order"`
	ObservedAt       time.Time `gorm:"not null"`
}

type AuditLog struct {
	ID             string         `gorm:"primaryKey;size:26"`
	OrganizationID string         `gorm:"size:26;not null;index"`
	ActorID        string         `gorm:"size:26;not null"`
	Action         string         `gorm:"size:200;not null"`
	TargetType     string         `gorm:"size:100;not null"`
	TargetID       string         `gorm:"size:26;not null"`
	Detail         datatypes.JSON `gorm:"not null"`
	CreatedAt      time.Time
}
