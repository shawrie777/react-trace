import { Node, SyntaxKind } from "ts-morph";
import { GraphNodeKind } from "./traceTypes";

export function getNodeId(node: Node): string {
  const sourceFile = node.getSourceFile();
  return `${sourceFile.getFilePath()}:${node.getStart()}:${node.getEnd()}`;
}

export function getLineNumber(node: Node): number {
  const sourceFile = node.getSourceFile();
  return sourceFile.getLineAndColumnAtPos(node.getStart()).line;
}

export function getLinePreview(node: Node): string {
  const sourceFile = node.getSourceFile();
  const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
  const lines = sourceFile.getFullText().split(/\r?\n/);
  return lines[line - 1]?.trim() ?? "";
}

export function getContainingFunctionName(node: Node): string {
  const func = node.getFirstAncestor(ancestor =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isArrowFunction(ancestor) ||
    Node.isConstructorDeclaration(ancestor)
  );

  if (!func) return "";

  if (Node.isFunctionDeclaration(func) || Node.isMethodDeclaration(func)) {
    return func.getName() ?? "";
  }

  if (Node.isConstructorDeclaration(func)) {
    return "constructor";
  }

  if (Node.isFunctionExpression(func) || Node.isArrowFunction(func)) {
    const parent = func.getParent();

    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }

    if (Node.isPropertyAssignment(parent)) {
      return parent.getName();
    }

    if (Node.isCallExpression(parent)) {
      return "<callback>";
    }
  }

  return "<anonymous>";
}

export function isTerminalValue(node: Node): boolean {
  return (
    Node.isNumericLiteral(node) ||
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    node.isKind(SyntaxKind.TrueKeyword) ||
    node.isKind(SyntaxKind.FalseKeyword) ||
    node.isKind(SyntaxKind.NullKeyword) ||
    node.isKind(SyntaxKind.UndefinedKeyword)
  );
}

export function getNodeKind(node: Node): GraphNodeKind {
  if (isTerminalValue(node)) return "literal";
  if (Node.isBinaryExpression(node)) return "assignment";
  if (Node.isCallExpression(node)) return "call";
  if (Node.isParameterDeclaration(node) || Node.isBindingElement(node)) return "parameter";
  if (Node.isPropertyAccessExpression(node)) return "property";
  if (Node.isReturnStatement(node)) return "return";
  if (Node.isIdentifier(node)) return "selection";
  return "expression";
}

export function isUserSourceNode(node: Node): boolean {
  const sourceFile = node.getSourceFile();
  return (
    !sourceFile.isFromExternalLibrary() &&
    !sourceFile.isInNodeModules() &&
    !sourceFile.isDeclarationFile()
  );
}

export function hasUserDeclaration(node: Node): boolean {
  const symbol = node.getSymbol();
  if (!symbol) return false;

  return symbol.getDeclarations().some(isUserSourceNode);
}

export function getSymbolKey(node: Node): string | undefined {
  const symbol = node.getSymbol();
  if (!symbol) return undefined;

  const declarations = symbol.getDeclarations();
  if (declarations.length === 0) return undefined;

  return declarations.map(getNodeId).sort().join("|");
}

export function nodesReferToSameSymbol(left: Node, right: Node): boolean {
  const leftKey = getSymbolKey(left);
  const rightKey = getSymbolKey(right);

  return !!leftKey && leftKey === rightKey;
}
