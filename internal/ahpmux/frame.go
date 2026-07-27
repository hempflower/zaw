package ahpmux

import (
	"encoding/json"
	"fmt"
)

type FrameType string

const (
	FrameOpen   FrameType = "open"
	FrameOpened FrameType = "opened"
	FrameData   FrameType = "data"
	FrameClose  FrameType = "close"
)

type Frame struct {
	Type     FrameType       `json:"type"`
	StreamID string          `json:"streamId"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	Reason   string          `json:"reason,omitempty"`
}

func (frame Frame) Validate() error {
	if frame.StreamID == "" {
		return fmt.Errorf("Mux frame requires streamId")
	}
	switch frame.Type {
	case FrameOpen, FrameOpened, FrameClose:
		if len(frame.Payload) != 0 {
			return fmt.Errorf("Mux %s frame cannot carry payload", frame.Type)
		}
	case FrameData:
		if len(frame.Payload) == 0 || !json.Valid(frame.Payload) {
			return fmt.Errorf("Mux data frame requires a JSON payload")
		}
	default:
		return fmt.Errorf("unknown Mux frame type %q", frame.Type)
	}
	return nil
}

func Marshal(frame Frame) []byte {
	payload, _ := json.Marshal(frame)
	return payload
}
