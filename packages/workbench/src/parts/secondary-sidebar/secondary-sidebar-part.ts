import { Emitter, Widget } from "@zaw/ui";
import {
  SessionDetailsView,
  type SessionDetailsViewOptions,
} from "../../views/session-details/session-details-view";
import type { IDetailTabRendererRegistry } from "../../views/session-details/detail-tab-renderer-registry";

export class SecondarySidebarPart extends Widget {
  private readonly _onDidClosePanel = this._register(new Emitter<void>());
  private readonly _onDidCloseTab = this._register(new Emitter<string>());
  private readonly _onDidOpenChange = this._register(new Emitter<string>());
  private readonly _onDidOpenDirectory = this._register(new Emitter<string>());
  private readonly _onDidOpenFile = this._register(new Emitter<string>());
  private readonly _onDidOpenFilesTab = this._register(new Emitter<void>());
  private readonly _onDidRefresh = this._register(new Emitter<void>());
  private readonly _onDidRequestRevertChange = this._register(
    new Emitter<string>(),
  );
  private readonly _onDidReviewChange = this._register(new Emitter<string>());
  private readonly _onDidSelectTab = this._register(new Emitter<string>());
  private readonly _onDidStageChange = this._register(new Emitter<string>());
  readonly onDidClosePanel = this._onDidClosePanel.event;
  readonly onDidCloseTab = this._onDidCloseTab.event;
  readonly onDidOpenChange = this._onDidOpenChange.event;
  readonly onDidOpenDirectory = this._onDidOpenDirectory.event;
  readonly onDidOpenFile = this._onDidOpenFile.event;
  readonly onDidOpenFilesTab = this._onDidOpenFilesTab.event;
  readonly onDidRefresh = this._onDidRefresh.event;
  readonly onDidRequestRevertChange = this._onDidRequestRevertChange.event;
  readonly onDidReviewChange = this._onDidReviewChange.event;
  readonly onDidSelectTab = this._onDidSelectTab.event;
  readonly onDidStageChange = this._onDidStageChange.event;

  constructor(
    root: HTMLElement,
    private readonly options: SessionDetailsViewOptions,
    registry: IDetailTabRendererRegistry,
  ) {
    super(root);
    const view = new SessionDetailsView(this.root, this.options, registry);
    view.onDidClosePanel(
      () => this._onDidClosePanel.fire(),
      undefined,
      this.disposables,
    );
    view.onDidCloseTab(
      (value) => this._onDidCloseTab.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidOpenChange(
      (value) => this._onDidOpenChange.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidOpenDirectory(
      (value) => this._onDidOpenDirectory.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidOpenFile(
      (value) => this._onDidOpenFile.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidOpenFilesTab(
      () => this._onDidOpenFilesTab.fire(),
      undefined,
      this.disposables,
    );
    view.onDidRefresh(
      () => this._onDidRefresh.fire(),
      undefined,
      this.disposables,
    );
    view.onDidRequestRevertChange(
      (value) => this._onDidRequestRevertChange.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidReviewChange(
      (value) => this._onDidReviewChange.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidSelectTab(
      (value) => this._onDidSelectTab.fire(value),
      undefined,
      this.disposables,
    );
    view.onDidStageChange(
      (value) => this._onDidStageChange.fire(value),
      undefined,
      this.disposables,
    );
  }
}
