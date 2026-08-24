import { Node } from "ts-morph";
import { getNodeId } from "../../nodeUtils";
import { findCallReturnValues } from "../callExpressions";
import { findExpressionSources } from "../expressions";
import { findIdentifierDefinitions } from "../identifiers";
import { getParameterDeclarationForIdentifier } from "../parameters";
import { TraceTarget } from "../types";
import { toTarget, dedupeTargets } from "../utils";
import { getStaticElementAccessName } from "../elementAccess";
import { findReactPropArguments } from "./jsx";

export function findPropertySourcesForExpression(
  expression: Node,
  propertyName: string,
  bindings: Map<string, TraceTarget>,
  allowObjectFallback: boolean = true,
): TraceTarget[] {
  if (Node.isIdentifier(expression)) {
    const parameter = getParameterDeclarationForIdentifier(expression);

    if (parameter) {
      const boundArgument = bindings.get(getNodeId(parameter));
      if (boundArgument) {
        return extractPropertyFromTarget(boundArgument, propertyName);
      }

      return findReactPropArguments(parameter, propertyName, bindings);
    }

    const objectDefinitions = findIdentifierDefinitions(expression, bindings);
    const propertyDefinitions = objectDefinitions.flatMap(definition =>
      extractPropertyFromTarget(definition, propertyName, allowObjectFallback)
    );

    return propertyDefinitions.length > 0 || !allowObjectFallback
      ? propertyDefinitions
      : objectDefinitions;
  }

  if (Node.isObjectLiteralExpression(expression)) {
    return extractPropertyFromObjectLiteral(expression, propertyName, bindings, allowObjectFallback);
  }

  if (Node.isCallExpression(expression)) {
    return findCallReturnValues(expression, bindings).flatMap(target =>
      extractPropertyFromTarget(target, propertyName, allowObjectFallback)
    );
  }

  return findExpressionSources(expression, bindings);
}

export function extractPropertyFromTarget(
  target: TraceTarget,
  propertyName: string,
  allowObjectFallback: boolean = true,
): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isObjectLiteralExpression(node)) {
    return extractPropertyFromObjectLiteral(node, propertyName, context, allowObjectFallback);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? findPropertySourcesForExpression(expression, propertyName, context, allowObjectFallback)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findCallReturnValues(node, context).flatMap(returnTarget =>
      extractPropertyFromTarget(returnTarget, propertyName, allowObjectFallback)
    );
  }

  if (Node.isIdentifier(node)) {
    return findPropertySourcesForExpression(node, propertyName, context, allowObjectFallback);
  }

  return allowObjectFallback ? [target] : [];
}

function extractPropertyFromObjectLiteral(
  objectLiteral: Node,
  propertyName: string,
  bindings: Map<string, TraceTarget>,
  allowObjectFallback: boolean = true
): TraceTarget[] {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return [];

  const targets: TraceTarget[] = [];
  const properties = objectLiteral.getProperties();

  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];

    if (
      Node.isPropertyAssignment(property) &&
      getStaticPropertyName(property.getNameNode()) === propertyName
    ) {
      const initializer = property.getInitializer();
      if (initializer) targets.push(toTarget(initializer, bindings, "property"));
      break;
    }

    if (Node.isShorthandPropertyAssignment(property) && property.getName() === propertyName) {
      targets.push(toTarget(property.getNameNode(), bindings, "property"));
      break;
    }

    if (Node.isSpreadAssignment(property)) {
      targets.push(...findPropertySourcesForExpression(
        property.getExpression(),
        propertyName,
        bindings,
        allowObjectFallback
      ));
    }
  }

  return dedupeTargets(targets);
}

export function getStaticPropertyName(nameNode: Node): string | undefined {
  if (Node.isIdentifier(nameNode)) return nameNode.getText();

  if (
    Node.isStringLiteral(nameNode) ||
    Node.isNumericLiteral(nameNode) ||
    Node.isNoSubstitutionTemplateLiteral(nameNode)
  ) {
    return nameNode.getLiteralText();
  }

  if (Node.isComputedPropertyName(nameNode)) {
    return getStaticElementAccessName(nameNode.getExpression());
  }

  return undefined;
}