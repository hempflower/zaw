import { mountWorkbench } from "@zaw/workbench";
import { installScrollViews } from "@zaw/ui";
import "@vscode/codicons/dist/codicon.css";
import "./styles.scss";

const root = document.getElementById("root");
if (!root) throw new Error("Workbench root element was not found");
installScrollViews(document.body);

async function start(): Promise<void> {
  try {
    const response = await fetch("/api/v1/auth/status");
    const status = (await response.json()) as { authenticated: boolean };
    if (status.authenticated) {
      mountWorkbench(root!);
      return;
    }
  } catch {
    // The login form reports connectivity errors when submitted.
  }
  renderLogin();
}

function renderLogin(): void {
  const shell = document.createElement("main");
  shell.className = "zaw-login";
  const form = document.createElement("form");
  form.className = "zaw-login-form";
  form.innerHTML = `
    <h1>ZAW</h1>
    <p>Sign in to your agent workspace</p>
    <label for="zaw-password">Password</label>
    <input id="zaw-password" name="password" type="password"
      autocomplete="current-password" autofocus required>
    <div class="zaw-login-error" role="alert" aria-live="polite"></div>
    <button type="submit">Sign In</button>`;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button")!;
    const error = form.querySelector<HTMLElement>(".zaw-login-error")!;
    const password = form.querySelector<HTMLInputElement>("input")!;
    button.disabled = true;
    error.textContent = "";
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.value }),
      });
      if (!response.ok) throw new Error("The password is incorrect.");
      root!.replaceChildren();
      mountWorkbench(root!);
    } catch (cause) {
      error.textContent =
        cause instanceof Error ? cause.message : "Unable to sign in.";
      password.select();
    } finally {
      button.disabled = false;
    }
  });
  shell.append(form);
  root!.replaceChildren(shell);
}

void start();
