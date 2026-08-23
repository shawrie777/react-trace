import { Node, SyntaxKind } from "ts-morph";

export function getNodeId(node: Node): string {
  const sourceFile = node.getSourceFile();
  return `${sourceFile.getFilePath()}:${node.getStart()}:${node.getEnd()}`;
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

function getSymbolKey(node: Node): string | undefined {
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
