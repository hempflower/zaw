# Releasing Zaw

Zaw uses one semantic version for the application and bundled Terraform
Provider. The authoritative value is `internal/version.Current`; official
templates and the local Provider mirror must use the same minor release.

## Release checklist

1. Update `internal/version.Current`, both official template constraints, and
   the Incus verifier's mirror path.
2. Update `CHANGELOG.md` and run `task lint`, `task test`, `task build`,
   `task test-e2e`, `pnpm test:e2e`, `task check-protocols`, and where available
   `task test-incus`.
3. Merge the release commit to `main`, create an annotated `vX.Y.Z` tag, and
   push the tag.
4. Wait for CI on the tag to pass.
5. Dispatch the `Release` workflow with the existing tag. It verifies the tag
   against `zaw version`, builds the Linux application and standard Terraform
   Provider archives, creates SHA-256 checksums, records GitHub provenance
   attestations, and publishes a GitHub Release.

`terraform-provider-zaw` is installed by the Provisioner from its bundled
filesystem mirror, so official templates do not depend on Terraform Registry
availability. Publishing to the public Terraform Registry additionally requires
a dedicated public `terraform-provider-zaw` source repository, an approved
Registry namespace, and a GPG signing identity. Do not advertise Registry
installation until those external prerequisites are complete.
