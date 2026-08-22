import * as vscode from 'vscode';
import { GraphNode } from './traceTypes';

export let traceView: TraceViewProvider | undefined;

export function createTraceViewProvider(extensionUri: vscode.Uri) {
  traceView = new TraceViewProvider(extensionUri);
  return traceView;
}

export class TraceViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'variableTracer.view';
  view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

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

            .preview {
              font-family: var(--vscode-editor-font-family);
              white-space: pre-wrap;
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
          ${renderNode(node)}
        </body>
      </html>`;
  }
}

function renderNode(node: GraphNode): string {
  return `<div class="node">
    <div class="preview">${escapeHtml(node.preview)}</div>
    <div class="meta">${escapeHtml(node.file)}:${node.line}</div>
    <div class="meta">${escapeHtml(node.containingFunc || "top level")}</div>
    ${node.children.map(renderNode).join("")}
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
