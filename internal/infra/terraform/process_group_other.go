//go:build !unix

package terraform

import "os/exec"

func configureProcessGroup(command *exec.Cmd) {
}
