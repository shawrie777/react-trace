import * as vscode from 'vscode';
import { GraphNode, GraphNodeKind } from './traceTypes';
import { positionTree } from './svg';

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
          <p>Trace view — No current trace.</p>
        </body>
      </html>`;
  }

  async render(node: GraphNode) {
    await vscode.commands.executeCommand("variableTracer.view.focus");
    if (!this.view) return;

    const PADDING = 20;
    const NODE_WIDTH = 250;
    const NODE_HEIGHT = 46;
    const TEXT_PADDING = 10;
    const PREVIEW_LENGTH = 30;
    const FUNCTION_LENGTH = 30;
    const tree = positionTree(node, NODE_WIDTH + 70, NODE_HEIGHT + 42);
    const maxX = Math.max(...tree.map(node => node.x)) + NODE_WIDTH + 2 * PADDING;
    const maxY = Math.max(...tree.map(node => node.y)) + NODE_HEIGHT + 2 * PADDING;

    this.view.show(true);
    this.view.webview.html = `<!DOCTYPE html>
      <html>
        <head>
          <style>
            html,
            body {
              background: var(--vscode-editor-background);
              color: var(--vscode-foreground);
              font-family: var(--vscode-font-family);
              margin: 0;
              width: 100%;
              height: 100%;
              overflow: hidden;
              padding: 0;
            }

            .trace-scroll {
              height: 100%;
              overflow: auto;
              width: 100%;
            }

            svg {
              display: block;
            }

            .trace-node {
              cursor: pointer;
            }

            .trace-node rect {
              stroke: color-mix(in srgb, var(--vscode-foreground) 35%, transparent);
              stroke-width: 1;
            }

            .trace-node:hover rect {
              stroke: var(--vscode-focusBorder);
              stroke-width: 2;
            }

            .trace-node text {
              font-family: var(--vscode-editor-font-family);
              pointer-events: none;
            }

            .trace-popup {
              background: var(--vscode-editorHoverWidget-background);
              border: 1px solid var(--vscode-editorHoverWidget-border);
              border-radius: 4px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
              color: var(--vscode-editorHoverWidget-foreground);
              font-size: 12px;
              line-height: 1.45;
              max-width: 420px;
              padding: 8px 10px;
              pointer-events: none;
              position: fixed;
              z-index: 10;
            }

            .trace-popup[hidden] {
              display: none;
            }

            .trace-popup-line {
              overflow-wrap: anywhere;
            }
          </style>
        </head>
        <body>
          <div class="trace-scroll">
            <svg width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">
              ${tree.filter(elem => elem.parent).map(elem => {
                  const minX = elem.parent!.x + NODE_WIDTH + PADDING;
                  const maxX = elem.x + PADDING;
                  const minY = elem.parent!.y + PADDING + NODE_HEIGHT / 2;
                  const maxY = elem.y + PADDING + NODE_HEIGHT / 2;
                  return `<path fill="none" stroke="var(--vscode-panel-border)" d="M ${minX} ${minY} C ${maxX} ${minY} ${minX} ${maxY} ${maxX} ${maxY}" />`;
              }).join("")}
              ${tree.map(positionedNode => {
                const x = positionedNode.x + PADDING;
                const y = positionedNode.y + PADDING;
                const displayPath = `${vscode.workspace.asRelativePath(positionedNode.node.file, false)}:${positionedNode.node.line}`;

                return `<g class="trace-node"
                  data-file="${escapeAttribute(positionedNode.node.file)}"
                  data-line="${positionedNode.node.line}"
                  data-location="${escapeAttribute(displayPath)}"
                  data-kind="${escapeAttribute(positionedNode.node.kind)}"
                  data-note="${escapeAttribute(positionedNode.node.note ?? "No note")}">
                  <rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8"
                    fill="${getNodeColour(positionedNode.node.kind)}"/>
                  <text x="${x + TEXT_PADDING}" y="${y + 18}" font-size="13" fill="white">${escapeHtml(truncate(positionedNode.node.preview, PREVIEW_LENGTH))}</text>
                  <text x="${x + TEXT_PADDING}" y="${y + 34}" font-size="12" fill="white" opacity="0.85">${escapeHtml(truncate(positionedNode.node.containingFunc || "top level", FUNCTION_LENGTH))}</text>
                </g>`;
              }).join("")}
            </svg>
          </div>
          <div id="trace-popup" class="trace-popup" hidden>
            <div id="trace-popup-location" class="trace-popup-line"></div>
            <div id="trace-popup-kind" class="trace-popup-line"></div>
            <div id="trace-popup-note" class="trace-popup-line"></div>
          </div>
          <script>
            const vscode = acquireVsCodeApi();
            const popup = document.querySelector("#trace-popup");
            const popupLocation = document.querySelector("#trace-popup-location");
            const popupKind = document.querySelector("#trace-popup-kind");
            const popupNote = document.querySelector("#trace-popup-note");

            function movePopup(event) {
              const gap = 12;
              let left = event.clientX + gap;
              let top = event.clientY + gap;
              const rect = popup.getBoundingClientRect();

              if (left + rect.width + gap > window.innerWidth) {
                left = event.clientX - rect.width - gap;
              }

              if (top + rect.height + gap > window.innerHeight) {
                top = event.clientY - rect.height - gap;
              }

              popup.style.left = Math.max(gap, left) + "px";
              popup.style.top = Math.max(gap, top) + "px";
            }

            document.querySelectorAll(".trace-node").forEach(node => {
              node.addEventListener("click", () => {
                vscode.postMessage({
                  type: "open",
                  file: node.getAttribute("data-file"),
                  line: Number(node.getAttribute("data-line")),
                });
              });

              node.addEventListener("mouseenter", event => {
                popupLocation.textContent = node.getAttribute("data-location") || "";
                popupKind.textContent = node.getAttribute("data-kind") || "";
                popupNote.textContent = node.getAttribute("data-note") || "";
                popup.hidden = false;
                movePopup(event);
              });

              node.addEventListener("mousemove", movePopup);

              node.addEventListener("mouseleave", () => {
                popup.hidden = true;
              });
            });
          </script>
        </body>
      </html>`;
  }
}

function getNodeColour(kind: GraphNodeKind): string {
    switch (kind) {
        case "assignment":
            return "#3B82F6"; // blue
        case "call":
            return "#8B5CF6"; // violet
        case "cycle":
            return "#EF4444"; // red
        case "context":
            return "#64748B"; // slate
        case "expression":
            return "#06B6D4"; // cyan
        case "external":
            return "#F59E0B"; // amber
        case "hook":
            return "#EC4899"; // pink
        case "literal":
            return "#10B981"; // emerald
        case "mutation":
            return "#F97316"; // orange
        case "parameter":
            return "#14B8A6"; // teal
        case "property":
            return "#6366F1"; // indigo
        case "return":
            return "#22C55E"; // green
        case "state":
            return "#A855F7"; // purple
        case "selection":
            return "#EAB308"; // yellow
        case "unknown":
            return "#6B7280"; // grey
    }
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

function truncate(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;

  return `${singleLine.slice(0, maxLength - 3)}...`;
}
