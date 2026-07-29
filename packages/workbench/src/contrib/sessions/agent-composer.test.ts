// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { ChatComposition } from "../../services/chat-session";
import { AgentComposer, readAttachment } from "./agent-composer";
import type { IActionRegistry } from "../../platform/actions/actions";
import type { ICommandService } from "../../platform/commands/commands";

const state = (): ChatComposition => ({
  agent: "copilot",
  approvalMode: "ask",
  attachments: [],
  draft: "hello",
  model: "",
  reasoningEffort: "",
});

describe("AgentComposer", () => {
  it("encodes text and image attachments as bare base64 blobs", async () => {
    await expect(
      readAttachment(new File(["hello"], "note.txt", { type: "text/plain" })),
    ).resolves.toMatchObject({
      contentType: "text/plain",
      data: "aGVsbG8=",
      displayKind: "document",
    });
    await expect(
      readAttachment(
        new File([new Uint8Array([0, 1, 2])], "pixel.png", {
          type: "image/png",
        }),
      ),
    ).resolves.toMatchObject({
      contentType: "image/png",
      data: "AAEC",
      displayKind: "image",
    });
  });

  it("submits on Enter but not Shift+Enter or during IME composition", () => {
    const composition = state();
    const submit = vi.fn();
    const composer = new AgentComposer({
      ariaLabel: "Prompt",
      composition: () => composition,
      models: () => [],
      onChange: (changes) => Object.assign(composition, changes),
      onSubmit: submit,
      placeholder: () => "Prompt",
    });
    composer.editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        shiftKey: true,
      }),
    );
    composer.editor.dispatchEvent(new CompositionEvent("compositionstart"));
    composer.editor.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(submit).not.toHaveBeenCalled();
    composer.editor.dispatchEvent(new CompositionEvent("compositionend"));
    composer.editor.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(submit).toHaveBeenCalledOnce();
  });

  it("shows progress without replacing the editor DOM", () => {
    const composition = state();
    let working = false;
    const composer = new AgentComposer({
      ariaLabel: "Prompt",
      composition: () => composition,
      models: () => [],
      onChange: (changes) => Object.assign(composition, changes),
      onSubmit: () => undefined,
      placeholder: () => "Prompt",
      working: () => working,
      workingAction: "progress",
    });
    const editor = composer.editor;
    const observer = new MutationObserver(() => undefined);
    observer.observe(composer.element, { childList: true, subtree: true });
    working = true;
    composer.refresh();
    const removed = observer
      .takeRecords()
      .flatMap((record) => Array.from(record.removedNodes));
    expect(composer.editor).toBe(editor);
    expect(removed.some((node) => node === editor)).toBe(false);
    expect(
      composer.element
        .querySelector<HTMLButtonElement>(".agent-primary-send-action")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    observer.disconnect();
  });

  it("renders and executes composer controls from chat-input actions", () => {
    const composition = state();
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const actions = {
      actions: () => [
        {
          command: "zaw.composer.attach",
          icon: "paperclip",
          id: "zaw.action.composer.attach",
          menu: "chat-input",
          title: "Add context",
        },
        {
          command: "zaw.composer.selectAgent",
          icon: "hubot",
          id: "zaw.action.composer.agent",
          menu: "chat-input",
          title: "Mode",
        },
        {
          command: "zaw.composer.selectModel",
          icon: "sparkle",
          id: "zaw.action.composer.model",
          menu: "chat-input",
          title: "Model",
        },
        {
          command: "zaw.composer.submit",
          icon: "send",
          id: "zaw.action.composer.submit",
          menu: "chat-input",
          title: "Run",
        },
      ],
    } as unknown as IActionRegistry;
    const composer = new AgentComposer({
      actions,
      ariaLabel: "Prompt",
      commands: { executeCommand } as unknown as ICommandService,
      composition: () => composition,
      models: () => [],
      onChange: (changes) => Object.assign(composition, changes),
      onSubmit: () => undefined,
      placeholder: () => "Prompt",
    });

    composer.element
      .querySelector<HTMLButtonElement>('[aria-label="Add context"]')
      ?.click();
    composer.element
      .querySelector<HTMLButtonElement>('[aria-label="Run"]')
      ?.click();

    expect(executeCommand.mock.calls.map(([id]) => id)).toEqual([
      "zaw.composer.attach",
      "zaw.composer.submit",
    ]);
  });

  it("hides Plan mode and presents stale Plan compositions as Agent", () => {
    const composition = { ...state(), mode: "plan" as const };
    const composer = new AgentComposer({
      ariaLabel: "Prompt",
      composition: () => composition,
      models: () => [],
      onChange: (changes) => Object.assign(composition, changes),
      onSubmit: () => undefined,
      placeholder: () => "Prompt",
    });

    const modePicker = composer.element.querySelector(".agent-mode-picker");
    expect(
      Array.from(
        modePicker?.querySelectorAll<HTMLButtonElement>(".zaw-dropdown-item") ??
          [],
        (item) => item.value,
      ),
    ).toEqual(["agent", "ask"]);
    expect(
      modePicker?.querySelector(".zaw-picker-action-label")?.textContent,
    ).toBe("Agent");
  });

  it("shows and clears the file drop overlay from real drag state", () => {
    const composition = state();
    const composer = new AgentComposer({
      ariaLabel: "Prompt",
      composition: () => composition,
      models: () => [],
      onChange: (changes) => Object.assign(composition, changes),
      onSubmit: () => undefined,
      placeholder: () => "Prompt",
    });
    const dragover = new Event("dragover", { cancelable: true });
    Object.defineProperty(dragover, "dataTransfer", {
      value: { types: ["Files"] },
    });
    composer.element.dispatchEvent(dragover);
    expect(composer.element.classList.contains("dragging-files")).toBe(true);
    composer.element.dispatchEvent(new Event("dragleave"));
    expect(composer.element.classList.contains("dragging-files")).toBe(false);
  });
});
