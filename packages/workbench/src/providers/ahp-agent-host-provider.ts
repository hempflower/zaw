import { injectable } from "inversify";
import { AHPClient } from "./ahp/ahp-client";
import type { IAgentHostProvider } from "../services/agent-host";

@injectable()
export class AHPAgentHostProvider implements IAgentHostProvider {
  connect(workspaceID: string) {
    return AHPClient.connect(workspaceID);
  }
}
