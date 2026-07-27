import type { IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import { ContributionRegistry } from "../../services/contribution-registry";
import type { SessionEvent } from "./session-event-view";

export const ISessionEventRendererRegistry = Symbol.for(
  "ISessionEventRendererRegistry",
);

export type SessionEventRenderAction = {
  approved: boolean;
  value: string;
};

export type SessionEventRendererContext = {
  emitConfirmToolCall: (action: SessionEventRenderAction) => void;
};

export type SessionEventRendererDescriptor = {
  factory: (
    root: HTMLElement,
    event: SessionEvent,
    context: SessionEventRendererContext,
  ) => IDisposable | void;
  id: string;
  kind: SessionEvent["kind"];
  order?: number;
  when?: () => boolean;
};

export interface ISessionEventRendererRegistry {
  all(): SessionEventRendererDescriptor[];
  get(id: string): SessionEventRendererDescriptor | undefined;
  rendererFor(
    kind: SessionEvent["kind"],
  ): SessionEventRendererDescriptor | undefined;
  register(descriptor: SessionEventRendererDescriptor): IDisposable;
}

@injectable()
export class SessionEventRendererRegistry
  extends ContributionRegistry<string, SessionEventRendererDescriptor>
  implements ISessionEventRendererRegistry
{
  rendererFor(kind: SessionEvent["kind"]) {
    return this.all().find((descriptor) => descriptor.kind === kind);
  }
}
