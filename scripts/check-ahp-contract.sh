#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$root/docs/protocols/sources.lock"

module=github.com/microsoft/agent-host-protocol/clients/go
module_version=$(go list -m -f '{{.Version}}' "$module")
module_metadata=$(go list -m -json "$module@$AHP_GO_MODULE_VERSION")
module_commit=$(sed -n 's/^[[:space:]]*"Hash": "\([^"]*\)",*$/\1/p' <<<"$module_metadata")
module_directory=$(go list -m -f '{{.Dir}}' "$module")
sdk_protocol_version=$(sed -n \
  's/^const ProtocolVersion = "\([^"]*\)"$/\1/p' \
  "$module_directory/ahptypes/version.generated.go")
typescript_protocol_version=$(sed -n \
  's/^export const AHP_PROTOCOL_VERSION = "\([^"]*\)";$/\1/p' \
  "$root/packages/protocol/src/index.ts")

test "$module_version" = "$AHP_GO_MODULE_VERSION"
test "$module_commit" = "$AHP_COMMIT"
test "v$sdk_protocol_version" = "$AHP_GO_MODULE_VERSION"
test "$typescript_protocol_version" = "$sdk_protocol_version"
