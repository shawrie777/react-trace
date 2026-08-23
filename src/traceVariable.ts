import * as vscode from "vscode";
import { Node } from "ts-morph";
import { trace } from "./traceEngine";
import { TraceTarget } from "./traceEngine/types";
import { getFreshSourceFile, project } from "./morphUtils";
import { traceView } from "./viewPanel";

export async function traceVariableOrigin() {
  if (!project) {
    vscode.window.showErrorMessage("traceVariable: no project found.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("traceVariable: no editor found.");
    return;
  }

  const position = editor.selection.active;
  const offset = editor.document.offsetAt(position);
  const sourceFile = getFreshSourceFile(editor.document);

  if (!sourceFile) {
    vscode.window.showErrorMessage("traceVariable: no source file found.");
    return;
  }

  const selectedNode = sourceFile.getDescendantAtPos(offset);
  if (!selectedNode || !Node.isIdentifier(selectedNode)) {
    return;
  }

  if (!canTraceSelection(selectedNode)) {
    vscode.window.showErrorMessage("traceVariable: not a user defined symbol.");
    return;
  }

  const traceNode = getTraceNodeFromSelection(selectedNode);
  const tree = await trace({node: traceNode, bindings: new Map<string, TraceTarget>()});

  if (tree) await traceView?.render(tree);
}

function getTraceNodeFromSelection(identifier: Node): Node {
  const parent = identifier.getParent();

  if (
    Node.isIdentifier(identifier) &&
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === identifier
  ) {
    return parent;
  }

  return identifier;
}

function canTraceSelection(identifier: Node): boolean {
  if (hasUserDeclaration(identifier)) return true;
  if (!Node.isIdentifier(identifier)) return false;

  const parent = identifier.getParent();

  if (
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === identifier
  ) {
    const expression = parent.getExpression();

    return (
      Node.isIdentifier(expression) &&
      expression.getText() === "props" &&
      hasUserDeclaration(expression) &&
      expression.getSymbol()?.getDeclarations().some(Node.isParameterDeclaration) === true
    );
  }

  return false;
}

function hasUserDeclaration(node: Node): boolean {
    return node.getSymbol()?.getDeclarations().some(node => {
        const sourceFile = node.getSourceFile();
            return (
                !sourceFile.isFromExternalLibrary() &&
                !sourceFile.isInNodeModules() &&
                !sourceFile.isDeclarationFile()
            );
        }) ?? false;
}