# Changelog

## v0.2.0

- Make `zaw_workspace` a zero-configuration Terraform data source backed by
  trusted Provisioner context.
- Bundle `terraform-provider-zaw` through an isolated filesystem mirror and use
  it from the official Incus and Docker templates.
- Preserve VM and container identity across stop/start while reserving Terraform
  destroy for delete builds.
- Add Agent-managed session todos to the Agent Host and Workbench.
- Run browser end-to-end coverage in CI and publish reproducible release assets
  with provenance attestations.

## v0.1.0

- Initial Zaw control plane, Agent Host, Workbench, Terraform templates, and
  self-installing Linux runtime release.
