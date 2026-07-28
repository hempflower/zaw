import { inject, injectable } from "inversify";
import { IWorkspaceAttachmentService } from "../../services/workspace-attachment";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";
import { IAHPProjectionService } from "./ahp-projection-service";

@injectable()
export class AHPProjectionContribution implements IWorkbenchContribution {
  private readonly unsubscribe: () => void;
  constructor(
    @inject(IWorkspaceAttachmentService)
    attachment: IWorkspaceAttachmentService,
    @inject(IAHPProjectionService) projection: IAHPProjectionService,
  ) {
    this.unsubscribe = attachment.onAction((workspaceID, action) =>
      projection.project(workspaceID, action),
    );
  }
  dispose(): void {
    this.unsubscribe();
  }
}
