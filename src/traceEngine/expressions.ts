import { Node, SyntaxKind } from "ts-morph";
import { isTerminalValue } from "../nodeUtils";
import { TraceTarget, FunctionLike } from "./types";
import { findIdentifierDefinitions } from "./identifiers";
import { findElementAccessSources } from "./elementAccess";
import { toTarget } from "./utils";
import { findPropertyAccessSources } from "./props/access";

export function findReturnedValueSources(node: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (!Node.isReturnStatement(node)) return [];

  const expression = node.getExpression();
  if (!expression) return [];

  return findExpressionSources(expression, bindings);
}

export function getReturnTargets(functionLike: FunctionLike, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (Node.isArrowFunction(functionLike)) {
    const body = functionLike.getBody();

    if (Node.isBlock(body)) {
      return body
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .map(returnStatement => toTarget(returnStatement, bindings, "return"));
    }

    return [toTarget(body, bindings, "return", "Implicit arrow-function return")];
  }

  const body = functionLike.getBody();
  if (!body) return [];

  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .map(returnStatement => toTarget(returnStatement, bindings, "return"));
}

export function findExpressionSources(node: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (isTerminalValue(node)) return [];

  if (Node.isIdentifier(node)) {
    return findIdentifierDefinitions(node, bindings);
  }

  if (Node.isPropertyAccessExpression(node)) {
    return findPropertyAccessSources(node, bindings);
  }

  if (Node.isElementAccessExpression(node)) {
    return findElementAccessSources(node, bindings);
  }

  if (Node.isCallExpression(node)) {
    return [toTarget(node, bindings, "call")];
  }

  if (Node.isBinaryExpression(node)) {
    return [
      ...findExpressionSources(node.getLeft(), bindings),
      ...findExpressionSources(node.getRight(), bindings),
    ];
  }

  if (Node.isConditionalExpression(node)) {
    return [
      ...findExpressionSources(node.getWhenTrue(), bindings),
      ...findExpressionSources(node.getWhenFalse(), bindings),
    ];
  }

  if (Node.isParenthesizedExpression(node)) {
    return findExpressionSources(node.getExpression(), bindings);
  }

  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isNonNullExpression(node)) {
    return findExpressionSources(node.getExpression(), bindings);
  }

  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().flatMap(element => findExpressionSources(element, bindings));
  }

  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().flatMap(property => {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer ? [toTarget(initializer, bindings, "property")] : [];
      }

      if (Node.isShorthandPropertyAssignment(property)) {
        return [toTarget(property.getNameNode(), bindings, "property")];
      }

      if (Node.isSpreadAssignment(property)) {
        return findExpressionSources(property.getExpression(), bindings);
      }

      return [];
    });
  }

  return node
    .getDescendants()
    .filter(Node.isIdentifier)
    .flatMap(identifier => findIdentifierDefinitions(identifier, bindings));
}
