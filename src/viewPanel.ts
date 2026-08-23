import * as vscode from 'vscode';
import { GraphNode } from './traceTypes';

export let traceView: TraceViewProvider | undefined;

export function createTraceViewProvider() {
  traceView = new TraceViewProvider();
  return traceView;
}

export class TraceViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'variableTracer.view';
  view: vscode.WebviewView | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.onDidReceiveMessage(async message => {
      if (message?.type !== "open" || typeof message.file !== "string") {
        return;
      }

      const line = typeof message.line === "number" ? Math.max(message.line - 1, 0) : 0;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(message.file));
      await vscode.window.showTextDocument(document, {
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: false,
      });
    });

    webviewView.webview.html = `<!DOCTYPE html>
      <html>
        <body>
          <p>Trace view — content coming soon.</p>
        </body>
      </html>`;
  }

  async render(node: GraphNode) {
    await vscode.commands.executeCommand("variableTracer.view.focus");
    if (!this.view) return;
    this.view.show(true);
    this.view.webview.html = `<!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: var(--vscode-font-family);
              font-size: var(--vscode-font-size);
              color: var(--vscode-foreground);
              padding: 12px;
            }

            .node {
              border-left: 1px solid var(--vscode-panel-border);
              margin: 8px 0 8px 8px;
              padding-left: 12px;
            }

            summary {
              cursor: pointer;
            }

            .preview {
              font-family: var(--vscode-editor-font-family);
              white-space: pre-wrap;
            }

            .kind {
              color: var(--vscode-badge-foreground);
              background: var(--vscode-badge-background);
              border-radius: 3px;
              display: inline-block;
              font-size: 0.85em;
              margin-bottom: 4px;
              padding: 1px 5px;
            }

            .toolbar {
              display: flex;
              gap: 12px;
              margin-bottom: 12px;
            }

            button {
              background: none;
              border: none;
              color: var(--vscode-textLink-foreground);
              cursor: pointer;
              font: inherit;
              padding: 0;
            }

            .meta {
              color: var(--vscode-descriptionForeground);
              font-size: 0.9em;
              margin-top: 2px;
            }
          </style>
        </head>
        <body>
          <h3>Trace Result</h3>
          <div class="toolbar">
            <button data-action="expand">Expand all</button>
            <button data-action="collapse">Collapse all</button>
          </div>
          ${renderNode(node)}
          <script>
            const vscode = acquireVsCodeApi();

            document.addEventListener("click", event => {
              const actionButton = event.target.closest("button[data-action]");
              if (actionButton) {
                const shouldOpen = actionButton.dataset.action === "expand";
                document.querySelectorAll("details.node").forEach(detail => {
                  detail.open = shouldOpen;
                });
                return;
              }

              const button = event.target.closest("button[data-file]");
              if (!button) return;

              vscode.postMessage({
                type: "open",
                file: button.dataset.file,
                line: Number(button.dataset.line),
              });
            });
          </script>
        </body>
      </html>`;
  }
}

function renderNode(node: GraphNode): string {
  const displayPath = `${vscode.workspace.asRelativePath(node.file, false)}:${node.line}`;

  return `<details class="node" open>
    <summary>
      <span class="kind">${escapeHtml(node.kind)}</span>
      <span class="preview">${escapeHtml(node.preview)}</span>
    </summary>
    <div class="meta">
      <button data-file="${escapeAttribute(node.file)}" data-line="${node.line}">
        ${escapeHtml(displayPath)}
      </button>
    </div>
    <div class="meta">${escapeHtml(node.containingFunc || "top level")}</div>
    ${node.note ? `<div class="meta">${escapeHtml(node.note)}</div>` : ""}
    ${node.children.map(renderNode).join("")}
  </details>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
