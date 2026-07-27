package build

import (
	"fmt"

	"github.com/zaw-dev/zaw/internal/domain/build"
)

type Service struct{}

func (Service) CanReport(current build.Status, next build.Status) error {
	if current == build.Succeeded || current == build.Failed || current == build.Cancelled {
		return fmt.Errorf("terminal build status cannot change")
	}
	switch current {
	case build.Claimed:
		if next == build.Running || next == build.Succeeded || next == build.Failed ||
			next == build.Cancelled {
			return nil
		}
	case build.Running:
		if next == build.Succeeded || next == build.Failed || next == build.Cancelled {
			return nil
		}
	}
	return fmt.Errorf("build status cannot change from %q to %q", current, next)
}
