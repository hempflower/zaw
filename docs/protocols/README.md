# Vendored protocol specifications

Zaw's official Go AHP client integration and Agent Host server are implemented
against the copy in this directory, not mutable upstream `main`. `sources.lock`
pins an exact upstream commit and
`scripts/vendor-protocol-specs.sh --check` compares the checked-in files
byte-for-byte with those commits. CI must run that check.

The vendored material keeps its upstream license in the protocol directory. A
protocol upgrade is an explicit, reviewable change: update the commit in the lock,
run the vendor script, update compatibility tests, and document the negotiated
versions accepted by Zaw.

The pinned Go module is
`github.com/microsoft/agent-host-protocol/clients/go v0.6.0`, from upstream
commit `3234536b9824a5b6bc45c37458261f675fdc65c9`. The vendored specification
comes from that same commit. `scripts/check-ahp-contract.sh` rejects drift
between the module version, module origin commit, generated Go protocol
constant and Workbench TypeScript constant.

The SDK owns client request correlation, subscriptions, reconnect commands,
event distribution and reducers. It provides client-side transports and a
multi-host client runtime, but no Agent Host JSON-RPC server runtime and no Zaw
logical mux. Zaw retains only those missing server/transport pieces and uses
official `ahptypes` for their wire envelopes, version and error codes.

Zaw's physical Agent Host connection uses the project-owned
[`zaw-ahp-mux.schema.json`](zaw-ahp-mux.schema.json). It has exactly four frame
types: `open`, `opened`, `data`, and `close`. `data.payload` is one complete AHP
JSON-RPC message. `streamId` defines an isolated JSON-RPC ID, initialize, and
subscription namespace; Mux never interprets or rewrites the payload.

Agent execution is not an additional wire protocol: Agent Host integrates
provider SDKs behind the `agentsdk.Runtime` boundary. The first adapter uses the
official GitHub Copilot Go SDK.
