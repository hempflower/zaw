import type { IDisposable } from "@zaw/ui";
import { injectable } from "inversify";
import { ContributionRegistry } from "../../services/contribution-registry";
import type {
  DetailTabKind,
  DetailTabViewModel,
  FileViewModel,
  WorkspaceChangeViewModel,
} from "../models";
import type { Workspace } from "@zaw/protocol";

export const IDetailTabRendererRegistry = Symbol.for(
  "IDetailTabRendererRegistry",
);

export type DetailTabRenderAction =
  | { kind: "openChange"; path: string }
  | { kind: "openDirectory"; uri: string }
  | { kind: "openFile"; uri: string }
  | { kind: "requestRevertChange"; path: string }
  | { kind: "reviewChange"; path: string }
  | { kind: "stageChange"; path: string };

export type DetailTabRendererContext = {
  changes: WorkspaceChangeViewModel[];
  emitAction: (action: DetailTabRenderAction) => void;
  files: FileViewModel[];
  workspace?: Workspace;
};

export type DetailTabRendererDescriptor = {
  factory: (
    root: HTMLElement,
    activeTab: DetailTabViewModel,
    context: DetailTabRendererContext,
  ) => IDisposable | void;
  icon: string;
  id: string;
  kind: DetailTabKind;
  order?: number;
  showWorkspaceScope?: boolean;
  renderHeader?: (
    root: HTMLElement,
    activeTab: DetailTabViewModel,
    context: DetailTabRendererContext,
  ) => void;
  when?: () => boolean;
};

export interface IDetailTabRendererRegistry {
  all(): DetailTabRendererDescriptor[];
  get(id: string): DetailTabRendererDescriptor | undefined;
  rendererFor(kind: DetailTabKind): DetailTabRendererDescriptor | undefined;
  register(descriptor: DetailTabRendererDescriptor): IDisposable;
}

@injectable()
export class DetailTabRendererRegistry
  extends ContributionRegistry<string, DetailTabRendererDescriptor>
  implements IDetailTabRendererRegistry
{
  rendererFor(kind: DetailTabKind) {
    return this.all().find((descriptor) => descriptor.kind === kind);
  }
}
