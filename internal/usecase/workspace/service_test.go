package workspace

import (
	"testing"

	domainworkspace "github.com/zaw-dev/zaw/internal/domain/workspace"
)

func TestWorkspaceLifecycle(t *testing.T) {
	service := Service{}
	current := domainworkspace.Workspace{
		DesiredState:  domainworkspace.DesiredRunning,
		ObservedState: domainworkspace.ObservedRunning,
	}
	next, err := service.NextDesiredState(current, domainworkspace.Stop)
	if err != nil {
		t.Fatalf("stop running workspace: %v", err)
	}
	if next != domainworkspace.DesiredStopped {
		t.Fatalf("desired state = %q", next)
	}
	if _, err := service.NextDesiredState(current, domainworkspace.Start); err == nil {
		t.Fatal("start running workspace was accepted")
	}
	stopped := domainworkspace.Workspace{
		DesiredState:  domainworkspace.DesiredStopped,
		ObservedState: domainworkspace.ObservedStopped,
	}
	for _, operation := range []domainworkspace.BuildOperation{
		domainworkspace.Reconfigure,
		domainworkspace.RebuildFromCurrentTemplate,
		domainworkspace.Repair,
	} {
		next, err := service.NextDesiredState(stopped, operation)
		if err != nil {
			t.Fatalf("%s stopped Workspace: %v", operation, err)
		}
		if next != domainworkspace.DesiredRunning {
			t.Fatalf("%s desired state = %q", operation, next)
		}
	}

	tests := []struct {
		operation domainworkspace.BuildOperation
		succeeded bool
		want      domainworkspace.ObservedState
	}{
		{domainworkspace.Create, true, domainworkspace.ObservedRunning},
		{domainworkspace.Start, true, domainworkspace.ObservedRunning},
		{domainworkspace.Stop, true, domainworkspace.ObservedStopped},
		{
			domainworkspace.Delete,
			true,
			domainworkspace.ObservedDeleted,
		},
		{domainworkspace.Start, false, domainworkspace.ObservedFailed},
	}
	for _, test := range tests {
		if got := service.ObservedStateAfter(test.operation, test.succeeded); got != test.want {
			t.Fatalf("observed state = %q, want %q", got, test.want)
		}
	}
}
