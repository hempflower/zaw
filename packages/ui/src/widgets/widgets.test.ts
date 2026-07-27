// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  ButtonWidget,
  CheckboxWidget,
  DialogWidget,
  DropdownPanelWidget,
  DropdownWidget,
  InputWidget,
  PrimaryButtonWidget,
  QuickPickWidget,
  RadioWidget,
  SelectWidget,
  SplitViewWidget,
  TabsWidget,
  TextAreaWidget,
  TreeWidget,
} from "../index";

function render(root: HTMLElement, widget: { render(): void }) {
  widget.render();
  return root;
}

describe("VS Code-style widgets", () => {
  it("renders unified form and button controls", () => {
    const buttonRoot = render(
      document.createElement("div"),
      new ButtonWidget(document.createElement("div"), {
        label: "Action",
        text: "Action",
      }),
    );
    render(buttonRoot, new ButtonWidget(buttonRoot, { label: "Action", text: "Action" }));
    expect(buttonRoot.querySelector(".zaw-button")?.textContent).toBe("Action");

    const primaryRoot = document.createElement("div");
    new PrimaryButtonWidget(primaryRoot, { label: "Save", text: "Save" }).render();
    expect(primaryRoot.querySelector("button")?.classList.contains("zaw-button-primary")).toBe(true);

    const inputRoot = document.createElement("div");
    new InputWidget(inputRoot, { ariaLabel: "Name" }).render();
    expect(inputRoot.querySelector("input")?.classList.contains("zaw-control")).toBe(true);

    const textAreaRoot = document.createElement("div");
    new TextAreaWidget(textAreaRoot, { ariaLabel: "Body" }).render();
    expect(textAreaRoot.querySelector("textarea")?.getAttribute("aria-label")).toBe(
      "Body",
    );

    const selectRoot = document.createElement("div");
    let selectedValue = "";
    new SelectWidget(selectRoot, {
      ariaLabel: "Theme",
      onDidSelect: (value) => {
        selectedValue = value;
      },
      options: [
        {
          description: "Follow the operating system",
          label: "System",
          value: "system",
        },
      ],
      value: "system",
    }).render();
    expect(selectRoot.querySelector(".zaw-select-menu")).toBeTruthy();
    expect(selectRoot.querySelector<HTMLInputElement>('input[type="hidden"]')?.value).toBe(
      "system",
    );
    expect(selectRoot.textContent).toContain("Follow the operating system");
    selectRoot.querySelector<HTMLButtonElement>(".zaw-select-option")?.click();
    expect(selectedValue).toBe("system");

    const radioRoot = document.createElement("div");
    new RadioWidget(radioRoot, { label: "One", name: "choice" }).render();
    expect(radioRoot.querySelector(".zaw-radio")).toBeTruthy();

    const checkboxRoot = document.createElement("div");
    new CheckboxWidget(checkboxRoot, { label: "Enabled", name: "enabled" }).render();
    expect(checkboxRoot.querySelector(".zaw-checkbox")).toBeTruthy();
  });

  it("renders reusable navigation and overlay widgets", () => {
    const panelRoot = document.createElement("div");
    new DropdownPanelWidget(panelRoot, {
      sections: [
        { items: [{ label: "Create" }] },
        { items: [{ label: "One", value: "one" }] },
      ],
    }).render();
    const dropdownRoot = document.createElement("div");
    new DropdownWidget(dropdownRoot, {
      ariaLabel: "Choose item",
      panel: panelRoot.firstElementChild ?? panelRoot,
      trigger: "Current",
      variant: "borderless",
    }).render();
    expect(dropdownRoot.querySelector(".zaw-dropdown-panel")).toBeTruthy();
    expect(dropdownRoot.querySelector(".zaw-dropdown-borderless")).toBeTruthy();
    expect(dropdownRoot.querySelector(".zaw-dropdown-item-content")?.textContent).toBe(
      "Create",
    );
    expect(dropdownRoot.textContent?.indexOf("Create")).toBeLessThan(
      dropdownRoot.textContent?.indexOf("One") ?? 0,
    );

    const tabsRoot = document.createElement("div");
    new TabsWidget(tabsRoot, {
      activeID: "one",
      onDidSelect: () => undefined,
      selectAction: "select",
      tabs: [{ id: "one", label: "One" }],
    }).render();
    expect(tabsRoot.querySelector('[role="tablist"]')).toBeTruthy();

    const treeRoot = document.createElement("div");
    new TreeWidget(treeRoot, [{ id: "one", label: "One" }], () => undefined).render();
    expect(treeRoot.querySelector('[role="tree"]')).toBeTruthy();

    const quickPickRoot = document.createElement("div");
    new QuickPickWidget(quickPickRoot, [{ id: "one", label: "One" }], () => undefined).render();
    expect(quickPickRoot.querySelector('[role="listbox"]')).toBeTruthy();

    const dialogRoot = document.createElement("div");
    new DialogWidget(dialogRoot, {
      body: document.createTextNode("Body"),
      onDidClose: () => undefined,
      title: "Dialog",
    }).render();
    expect(dialogRoot.querySelector('[aria-modal="true"]')).toBeTruthy();

    const splitRoot = document.createElement("div");
    new SplitViewWidget(splitRoot, {
      first: document.createTextNode("First"),
      orientation: "horizontal",
      resizeID: "main",
      second: document.createTextNode("Second"),
    }).render();
    expect(splitRoot.querySelector("[data-resize-split='main']")).toBeTruthy();
  });
});
