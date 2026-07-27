// Package agentsdk defines the Agent Host boundary for pluggable agent SDKs.
package agentsdk

import (
	"context"
	"encoding/json"
	"time"
)

type Runtime interface {
	CreateSession(context.Context, SessionOptions) (Session, error)
	Close() error
}

type Session interface {
	ID() string
	Prompt(context.Context, PromptRequest) error
	Cancel(context.Context) error
	Close() error
}

type PromptRequest struct {
	Text        string
	Model       string
	Attachments []Attachment
}

type Attachment struct {
	Label       string
	Data        string
	ContentType string
}

type SessionOptions struct {
	ID               string
	WorkingDirectory string
	Model            string
	OnEvent          func(Event)
	OnPermission     func(context.Context, PermissionRequest) PermissionDecision
}

type Event struct {
	ID        string    `json:"id,omitempty"`
	Type      string    `json:"type"`
	Timestamp time.Time `json:"timestamp"`
	Data      any       `json:"data,omitempty"`
}

type PermissionRequest struct {
	ID   string
	Kind string
	Data json.RawMessage
}

type PermissionDecision string

const (
	PermissionAllowOnce PermissionDecision = "allow_once"
	PermissionDeny      PermissionDecision = "deny"
	PermissionCancel    PermissionDecision = "cancel"
)
