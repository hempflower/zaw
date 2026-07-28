import { Disposable, Emitter, type Event, type IDisposable } from "@zaw/ui";
import type { IAgentHost, IAgentHostProvider } from "./agent-host";

export const IAgentHostProviderRegistry = Symbol.for(
  "IAgentHostProviderRegistry",
);

export type AgentHostProviderDescriptor = Readonly<{
  canHandle?: (workspaceID: string) => boolean;
  id: string;
  order?: number;
  provider: IAgentHostProvider;
}>;

export interface IAgentHostProviderRegistry extends IAgentHostProvider {
  readonly onDidChange: Event<void>;
  all(): readonly AgentHostProviderDescriptor[];
  register(descriptor: AgentHostProviderDescriptor): IDisposable;
}

/** Selects an Agent Host adapter without coupling attachment state to a transport. */
export class AgentHostProviderRegistry
  extends Disposable
  implements IAgentHostProviderRegistry
{
  private readonly providers = new Map<string, AgentHostProviderDescriptor>();
  private readonly emitter = this._register(new Emitter<void>());
  readonly onDidChange = this.emitter.event;

  all(): readonly AgentHostProviderDescriptor[] {
    return [...this.providers.values()].sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) ||
        left.id.localeCompare(right.id),
    );
  }

  register(descriptor: AgentHostProviderDescriptor): IDisposable {
    if (this.providers.has(descriptor.id))
      throw new Error(`Agent Host provider "${descriptor.id}" is registered`);
    this.providers.set(descriptor.id, descriptor);
    this.emitter.fire();
    return {
      dispose: () => {
        if (this.providers.get(descriptor.id) !== descriptor) return;
        this.providers.delete(descriptor.id);
        this.emitter.fire();
      },
    };
  }

  connect(workspaceID: string): Promise<IAgentHost> {
    const descriptor = this.all().find(
      (candidate) => !candidate.canHandle || candidate.canHandle(workspaceID),
    );
    if (!descriptor)
      return Promise.reject(
        new Error(`No Agent Host provider can attach "${workspaceID}"`),
      );
    return descriptor.provider.connect(workspaceID);
  }
}
