# Zaw

Local development uses [Task](https://taskfile.dev/): run `task up`, `task deps`,
`task migrate`, and `task server` for the control plane. `task provisioner` starts a
local worker and `task web` starts the Browser Workbench. `task check-protocols`
verifies the pinned AHP copy. The documented M0–M26 architecture is in
[docs/README.md](docs/README.md).

Install Go, Node.js, pnpm, Terraform, and Task directly on the host; project
compilation does not use Docker. Exact versions and the clean-environment workflow
are documented in [Local development](docs/development.md). Run `task fmt`,
`task lint`, `task test`, and `task build` before submitting a change.

The Server loads `.env` automatically (copy `.env.example`) and supports GORM with
either MySQL or SQLite. Set `ZAW_DATABASE_DRIVER=mysql` with a MySQL DSN for the
local Compose profile, or set `ZAW_DATABASE_DRIVER=sqlite` and
`ZAW_DATABASE_DSN=./.data/zaw.db` for a single-file local database. Models use
explicit timestamps only; GORM soft deletion is not enabled.

Set distinct `ZAW_PASSWORD`, `ZAW_AUTH_SIGNING_KEY`, and `ZAW_PROVISIONER_KEY` values before starting the
Server. The former protects the single-user Workbench; the latter authenticates
Provisioner registration, polling, and build reporting.

The local Provisioner stores Terraform state under `ZAW_TERRAFORM_STATE_DIR`,
with one state file per Workspace. Keep this directory persistent and back it up
with the control-plane database.
The runnable Docker Terraform example is in
[examples/templates/docker-workspace](/home/evanxiao/zaw/zaw/examples/templates/docker-workspace).
Its persistent home volume survives a stop build; only delete destroys it.
The template-facing Agent injection resource is documented in
[terraform-provider-zaw.md](docs/architecture/terraform-provider-zaw.md).

An Agent Host requires a Workspace ID, protected registration credential, working
directory, and GitHub Copilot CLI, for example `zaw agent-host --workspace-id
<id> --copilot-cli copilot`. The Agent Host owns complete Session, Chat, Terminal and
Changeset state. The Server uses the official Go AHP client over logical mux
streams and persists only a lightweight SessionSummary read model for the HTTP
catalog; it does not persist complete AHP snapshots or event streams.

The Server owns model configuration for OpenAI, Anthropic, and DeepSeek. Users
provide each Provider's API base and key; keys remain in protected local files under
`ZAW_SECRET_STORE_DIR`. Agent Host uses the Server's neutral, streaming LLM gateway
and never receives an upstream key.

The local profile intentionally uses a fixed development administrator. It must not
be exposed outside a developer machine.
