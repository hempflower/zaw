/**
 * Manually reviewed source annotations for the fixed VS Code Agents Window.
 * These values constrain the screenshot baseline; the PNG is only a regression
 * artifact and is never treated as an independent source of truth.
 */
export const vscodeAgentsWindowFixture = {
  commit: "27e3232864f30340158056fc4520a596030eca7a",
  geometry: {
    auxiliaryWidth: 340,
    composerActionSize: 22,
    panelRadius: 8,
    partGap: 8,
    shellBottomInset: 10,
    shellLeftInset: 4,
    shellRightInset: 10,
    sidebarWidth: 300,
  },
  sources: {
    auxiliary:
      "https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/auxiliaryBarPart.css",
    chatInput:
      "https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/contrib/chat/browser/media/chatInput.css",
    panel:
      "https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/parts/media/panelPart.css",
    shell:
      "https://github.com/microsoft/vscode/blob/27e3232864f30340158056fc4520a596030eca7a/src/vs/sessions/browser/media/workbench.css",
  },
} as const;
