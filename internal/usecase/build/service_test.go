package build

import (
	"testing"

	domainbuild "github.com/zaw-dev/zaw/internal/domain/build"
)

func TestBuildStatusTransitions(t *testing.T) {
	service := Service{}
	accepted := [][2]domainbuild.Status{
		{domainbuild.Claimed, domainbuild.Running},
		{domainbuild.Claimed, domainbuild.Succeeded},
		{domainbuild.Running, domainbuild.Failed},
	}
	for _, transition := range accepted {
		if err := service.CanReport(transition[0], transition[1]); err != nil {
			t.Fatalf("transition %q -> %q: %v", transition[0], transition[1], err)
		}
	}
	rejected := [][2]domainbuild.Status{
		{domainbuild.Queued, domainbuild.Succeeded},
		{domainbuild.Running, domainbuild.Claimed},
		{domainbuild.Succeeded, domainbuild.Running},
	}
	for _, transition := range rejected {
		if err := service.CanReport(transition[0], transition[1]); err == nil {
			t.Fatalf("transition %q -> %q was accepted", transition[0], transition[1])
		}
	}
}
