import { Node, Statement } from "ts-morph";

export function getContainingStatement(node: Node): Statement | undefined {
  if (Node.isStatement(node)) return node;
  return node.getFirstAncestor(Node.isStatement);
}

export function getSiblingStatements(statement: Statement): Statement[] | undefined {
  const parent = statement.getParent();

  if (Node.isBlock(parent) || Node.isSourceFile(parent)) {
    return parent.getStatements();
  }

  return undefined;
}

export function getContainingOuterStatement(statement: Statement): Statement | undefined {
  let current = statement.getParent();

  while (current) {
    if (Node.isSourceFile(current)) return undefined;

    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return undefined;
    }

    if (Node.isStatement(current)) return current;

    current = current.getParent();
  }

  return undefined;
}