import { inject, injectable } from "inversify";
import { IThemeService } from "../../platform/theme/theme-service";
import type { IWorkbenchContribution } from "../../workbench/contributions/workbench-contributions";

/** Applies persisted theme before feature views are created. */
@injectable()
export class ThemeContribution implements IWorkbenchContribution {
  constructor(@inject(IThemeService) theme: IThemeService) {
    theme.initialize();
  }
}
