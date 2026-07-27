import { mountWorkbench } from "@zaw/workbench";
import "@vscode/codicons/dist/codicon.css";
import "./styles.scss";

const root = document.getElementById("root");
if (!root) throw new Error("Workbench root element was not found");
mountWorkbench(root);
