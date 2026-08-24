import { BindingElement, Node } from "ts-morph";
import { getBindingElementPropertyName } from "../bindingElements";
import { findCallReturnValues } from "../callExpressions";
import { TraceTarget } from "../types";
import { findIdentifierDefinitions } from "../identifiers";
import { toTarget } from "../utils";
import { getStaticPropertyName } from "./sources";

export function getObjectRestOmittedNames(restElement: BindingElement): Set<string> {
  const bindingPattern = restElement.getParent();
  if (!Node.isObjectBindingPattern(bindingPattern)) return new Set();

  return new Set(
    bindingPattern
      .getElements()
      .filter(element => element !== restElement)
      .map(getBindingElementPropertyName)
      .filter((name): name is string => !!name)
  );
}

export function extractObjectRestFromTarget(
  target: TraceTarget,
  omittedNames: Set<string>
): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isObjectLiteralExpression(node)) {
    return extractObjectRestFromObjectLiteral(node, omittedNames, context);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? extractObjectRestFromExpression(expression, omittedNames, context)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findCallReturnValues(node, context).flatMap(returnTarget =>
      extractObjectRestFromTarget(returnTarget, omittedNames)
    );
  }

  if (Node.isIdentifier(node)) {
    return extractObjectRestFromExpression(node, omittedNames, context);
  }

  return [{ ...target, note: target.note ?? "Object rest source" }];
}

export function extractObjectRestFromExpression(
  expression: Node,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (Node.isIdentifier(expression)) {
    const objectDefinitions = findIdentifierDefinitions(expression, bindings);
    const restTargets = objectDefinitions.flatMap(definition =>
      extractObjectRestFromTarget(definition, omittedNames)
    );

    return restTargets.length > 0
      ? restTargets
      : [toTarget(expression, bindings, "property", "Object rest source")];
  }

  if (Node.isObjectLiteralExpression(expression)) {
    return extractObjectRestFromObjectLiteral(expression, omittedNames, bindings);
  }

  if (Node.isCallExpression(expression)) {
    return findCallReturnValues(expression, bindings).flatMap(target =>
      extractObjectRestFromTarget(target, omittedNames)
    );
  }

  return [toTarget(expression, bindings, "property", "Object rest source")];
}

function extractObjectRestFromObjectLiteral(
  objectLiteral: Node,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return [];

  return objectLiteral.getProperties().flatMap(property => {
    if (Node.isPropertyAssignment(property)) {
      const propertyName = getStaticPropertyName(property.getNameNode());
      const initializer = property.getInitializer();

      return propertyName && !omittedNames.has(propertyName) && initializer
        ? [toTarget(initializer, bindings, "property", `Object rest property: ${propertyName}`)]
        : [];
    }

    if (Node.isShorthandPropertyAssignment(property) && !omittedNames.has(property.getName())) {
      return [
        toTarget(property.getNameNode(), bindings, "property", `Object rest property: ${property.getName()}`),
      ];
    }

    if (Node.isSpreadAssignment(property)) {
      return [toTarget(property.getExpression(), bindings, "property", "Object spread source for rest")];
    }

    return [];
  });
}