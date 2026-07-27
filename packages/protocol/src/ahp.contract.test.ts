import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AHP_PROTOCOL_VERSION } from "./index";
import type {
  AHPActionEnvelope,
  AHPInitializeParams,
  AHPInitializeResult,
  AHPMuxFrame,
} from "./index";

type SchemaDefinition = {
  required?: string[];
};

type Schema = {
  $defs: Record<string, SchemaDefinition>;
};

function schema(name: string): Schema {
  const path = new URL(
    `../../../docs/protocols/ahp/schema/${name}`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(path, "utf8")) as Schema;
}

describe("pinned AHP TypeScript contract", () => {
  it("keeps initialize and action fields aligned with the vendored schemas", () => {
    const commands = schema("commands.schema.json");
    const actions = schema("actions.schema.json");
    expect(commands.$defs.InitializeParams?.required).toEqual(
      expect.arrayContaining(["channel", "protocolVersions", "clientId"]),
    );
    expect(commands.$defs.InitializeResult?.required).toEqual(
      expect.arrayContaining(["protocolVersion", "serverSeq", "snapshots"]),
    );
    expect(actions.$defs.ActionEnvelope?.required).toEqual(
      expect.arrayContaining(["channel", "action", "serverSeq"]),
    );
  });

  it("type-checks Workbench handshake fixtures at protocol 0.6.0", () => {
    const initialize = {
      channel: "ahp-root://",
      protocolVersions: [AHP_PROTOCOL_VERSION],
      clientId: "contract-test",
      initialSubscriptions: ["ahp-root://"],
    } satisfies AHPInitializeParams;
    const result = {
      protocolVersion: AHP_PROTOCOL_VERSION,
      serverSeq: 1,
      snapshots: [],
    } satisfies AHPInitializeResult;
    const action = {
      channel: "ahp-root://",
      action: { type: "root/terminalsChanged" },
      serverSeq: 2,
    } satisfies AHPActionEnvelope;
    expect(initialize.protocolVersions).toEqual([result.protocolVersion]);
    expect(action.serverSeq).toBeGreaterThan(result.serverSeq);
  });

  it("keeps the project-owned Mux schema and TypeScript union aligned", () => {
    const path = new URL(
      "../../../docs/protocols/zaw-ahp-mux.schema.json",
      import.meta.url,
    );
    const mux = JSON.parse(readFileSync(path, "utf8")) as {
      oneOf: Array<{
        properties: { type: { const: string } };
        required: string[];
      }>;
    };
    expect(mux.oneOf.map((variant) => variant.properties.type.const)).toEqual([
      "open",
      "opened",
      "data",
      "close",
    ]);
    const fixture = {
      type: "data",
      streamId: "stream-1",
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    } satisfies AHPMuxFrame;
    expect(fixture.streamId).toBe("stream-1");
  });
});
