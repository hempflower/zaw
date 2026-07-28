# Incus Ubuntu 24.04 VM Workspace Template

This template creates an Incus virtual machine from
`images:ubuntu/24.04/cloud`. It expects the existing `default` profile and
`default` storage pool found in a standard Incus installation; both are
configurable through variables.

The VM and its separate `/workspace` custom volume persist across a Zaw `stop`
build. The template sets the Incus resource's `running` state to false, which
stops the existing VM in place; a later start sets it back to true. Only
`delete` invokes `terraform destroy`, which removes both VM and volume.

## Agent bootstrap

The Provisioner supplies the immutable workspace ID and `running` lifecycle state. The
template derives the Agent Host environment and init script from those inputs,
writes them with cloud-init, downloads the checksummed Agent Host directly from
the Zaw control plane, installs the official GitHub Copilot CLI v1.0.75, and
starts a systemd service. Relevant parameters:

```hcl
zaw_server_url       = "ws://10.99.0.1:8080"
zaw_agent_provider   = "copilot"
zaw_copilot_cli_path = "/usr/local/bin/copilot"
zaw_install_command  = "# optional Agent SDK dependency install command"
```

`zaw_server_url` must be routable from the VM. Agent Host binaries are served by
the control plane from the public, platform-scoped `/downloads/zaw/...` route;
the bootstrap verifies its SHA-256 response header before installation. After
bootstrap, the Agent Host checks that route every 15 minutes and atomically
installs a changed runtime. The download contains no Workspace credential and
does not require authentication.

After `terraform apply`, the Provisioner requests a Workspace-scoped Agent Host
registration credential for the claimed Build and writes it directly to
`/etc/zaw/registration.token` with `incus file push`. Cloud-init never receives
that value, so the credential is absent from Terraform variables, State, logs,
and command-line arguments. The Agent Host reuses the protected credential and
does not implement a separate token rotation protocol. `ZAW_INCUS_BINARY`
selects the local Incus CLI.

## Local lifecycle verification

With Incus, Terraform, `jq`, and Go installed on the host, run:

```sh
task test-incus
```

The check creates a uniquely named Ubuntu 24 VM, proves that stop is an
in-place update with no delete action, restarts the same VM identity, verifies
runtime installation and protected credential injection, and finally destroys only its own
isolated VM and volume. State is stored in the verification working directory.

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
