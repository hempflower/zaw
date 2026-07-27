# Incus Ubuntu 24.04 VM Workspace Template

This template creates an Incus virtual machine from
`images:ubuntu/24.04/cloud`. It expects the existing `default` profile and
`default` storage pool found in a standard Incus installation; both are
configurable through variables.

The VM and its separate `/workspace` custom volume persist across a Zaw `stop`
build. The template sets the Incus resource's `running` state to false, which
stops the existing VM in place; a later start sets it back to true. Only
`delete` invokes `terraform destroy`, which removes both VM and volume.

## Agent injection

The Provisioner injects the immutable workspace ID and `running` lifecycle state. The
template derives the Agent Host environment and init script from those inputs,
writes them with cloud-init, and starts a systemd service after a `zaw` binary
is available. Set these template parameters for a usable Agent Host:

```hcl
zaw_server_url       = "ws://10.99.0.1:8080"
zaw_agent_provider   = "copilot"
zaw_copilot_cli_path = "/usr/local/bin/copilot"
zaw_install_command  = "install -m 0755 /path/to/zaw /usr/local/bin/zaw"
```

`zaw_server_url` must be routable from the VM. The install command is
deliberately explicit: Zaw has no public binary distribution configured by this
repository, so the template does not invent an unsafe download location. The image
must also contain the GitHub Copilot CLI required by its official Go SDK.

After `terraform apply`, the Provisioner requests a Workspace-scoped Agent Host
registration credential for the claimed Build and writes it directly to
`/etc/zaw/registration.token` with `incus file push`. Cloud-init never receives
that value, so the credential is absent from Terraform variables, State, logs,
and command-line arguments. The Agent Host reuses the protected credential and
does not implement a separate token rotation protocol. `ZAW_INCUS_BINARY`
selects the local Incus CLI.

## Local lifecycle verification

With Incus, Terraform, `jq`, MinIO, and Go installed on the host, run:

```sh
task test-incus
```

The check creates a uniquely named Ubuntu 24 VM, proves that stop is an
in-place update with no delete action, restarts the same VM identity, verifies
binary and protected credential injection, and finally destroys only its own
isolated VM and volume. State is stored under a unique `verification/` key in
the configured S3-compatible bucket.

## Provider setup

The runnable template only requires the published `lxc/incus` provider. The
companion `zaw_agent` provider resource is implemented in this repository for
templates that need a reusable injection abstraction after that provider is
published. Build it for local development with:

```sh
go build -o terraform-provider-zaw ./cmd/terraform-provider-zaw
```

For development, configure Terraform's `dev_overrides` to point at the
directory containing that binary. It is intentionally not required by this
template, because `terraform init` cannot install an unpublished provider.
