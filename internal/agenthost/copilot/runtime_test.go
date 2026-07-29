package copilot

import (
	"reflect"
	"testing"

	copilotsdk "github.com/github/copilot-sdk/go"
	"github.com/github/copilot-sdk/go/rpc"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

func TestCopilotCLIArgsDisablePracticalAutopilotLimit(t *testing.T) {
	want := []string{
		"--autopilot",
		"--max-autopilot-continues", "9007199254740991",
	}
	if got := copilotCLIArgs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("copilot CLI args = %v, want %v", got, want)
	}
}

func TestMessageOptionsCarryAutopilotModePerTurn(t *testing.T) {
	request := agentsdk.PromptRequest{Text: "finish the task", AgentMode: "autopilot"}
	options := messageOptions(request, nil)
	if options.Prompt != request.Text {
		t.Fatalf("prompt = %q, want %q", options.Prompt, request.Text)
	}
	if options.AgentMode != copilotsdk.AgentModeAutopilot {
		t.Fatalf("agent mode = %q, want %q", options.AgentMode, copilotsdk.AgentModeAutopilot)
	}
}

func TestAutopilotContinuesUntilTaskComplete(t *testing.T) {
	session := &copilotSession{}
	session.beginTurn(true)

	forward, continueAutopilot := session.eventDisposition("session.idle")
	if forward || !continueAutopilot {
		t.Fatalf("first idle = forward %t, continue %t", forward, continueAutopilot)
	}
	forward, continueAutopilot = session.eventDisposition("session.idle")
	if forward || continueAutopilot {
		t.Fatalf("duplicate idle = forward %t, continue %t", forward, continueAutopilot)
	}

	session.mu.Lock()
	session.continuing = false
	session.mu.Unlock()
	forward, continueAutopilot = session.eventDisposition("session.task_complete")
	if !forward || continueAutopilot {
		t.Fatalf("task complete = forward %t, continue %t", forward, continueAutopilot)
	}
	forward, continueAutopilot = session.eventDisposition("session.idle")
	if !forward || continueAutopilot {
		t.Fatalf("final idle = forward %t, continue %t", forward, continueAutopilot)
	}
}

func TestInteractiveIdleCompletesNormally(t *testing.T) {
	session := &copilotSession{}
	session.beginTurn(false)
	forward, continueAutopilot := session.eventDisposition("session.idle")
	if !forward || continueAutopilot {
		t.Fatalf("interactive idle = forward %t, continue %t", forward, continueAutopilot)
	}
}

func TestAutopilotErrorStopsContinuation(t *testing.T) {
	session := &copilotSession{}
	session.beginTurn(true)
	forward, continueAutopilot := session.eventDisposition("session.error")
	if !forward || continueAutopilot {
		t.Fatalf("error = forward %t, continue %t", forward, continueAutopilot)
	}
	forward, continueAutopilot = session.eventDisposition("session.idle")
	if !forward || continueAutopilot {
		t.Fatalf("idle after error = forward %t, continue %t", forward, continueAutopilot)
	}
}

func TestAgentModeMappings(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		sessionMode rpc.SessionMode
		sendMode    copilotsdk.AgentMode
	}{
		{
			name:        "interactive",
			input:       "interactive",
			sessionMode: rpc.SessionModeInteractive,
			sendMode:    copilotsdk.AgentModeInteractive,
		},
		{
			name:        "plan",
			input:       "plan",
			sessionMode: rpc.SessionModePlan,
			sendMode:    copilotsdk.AgentModePlan,
		},
		{
			name:        "autopilot",
			input:       "autopilot",
			sessionMode: rpc.SessionModeAutopilot,
			sendMode:    copilotsdk.AgentModeAutopilot,
		},
		{
			name:        "unknown defaults to interactive",
			input:       "unknown",
			sessionMode: rpc.SessionModeInteractive,
			sendMode:    copilotsdk.AgentModeInteractive,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sessionMode(test.input); got != test.sessionMode {
				t.Errorf("session mode = %q, want %q", got, test.sessionMode)
			}
			if got := sendAgentMode(test.input); got != test.sendMode {
				t.Errorf("send mode = %q, want %q", got, test.sendMode)
			}
		})
	}
}
