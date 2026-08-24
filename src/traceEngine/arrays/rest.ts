import { BindingElement, Node } from "ts-morph";
import { getNodeId } from "../../nodeUtils";
import { findCallSiteArguments } from "../parameters";
import { TraceTarget } from "../types";
import { findCallReturnValues } from "../callExpressions";
import { findIdentifierDefinitions } from "../identifiers";
import { dedupeTargets, toTarget } from "../utils";
import { findArrayMethodReturnValues } from "./methods";

export function findArrayRestBindingElementSources(
  bindingElement: BindingElement,
  startIndex: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const bindingPattern = bindingElement.getParent();
  if (!Node.isArrayBindingPattern(bindingPattern)) return [];

  const bindingOwner = bindingPattern.getParent();

  if (Node.isParameterDeclaration(bindingOwner)) {
    const boundArgument = bindings.get(getNodeId(bindingOwner));
    return boundArgument
      ? extractArrayRestFromTarget(boundArgument, startIndex)
      : findCallSiteArguments(bindingOwner, bindings)
          .flatMap(argument => extractArrayRestFromTarget(argument, startIndex));
  }

  if (Node.isVariableDeclaration(bindingOwner)) {
    const initializer = bindingOwner.getInitializer();
    return initializer
      ? extractArrayRestFromExpression(initializer, startIndex, bindings)
      : [];
  }

  return [];
}

function extractArrayRestFromTarget(target: TraceTarget, startIndex: number): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isArrayLiteralExpression(node)) {
    return extractArrayRestFromArrayLiteral(node, startIndex, context);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? extractArrayRestFromExpression(expression, startIndex, context)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return extractArrayRestFromExpression(node, startIndex, context);
  }

  if (Node.isIdentifier(node)) {
    return extractArrayRestFromExpression(node, startIndex, context);
  }

  return [{ ...target, note: target.note ?? "Array rest source" }];
}

function extractArrayRestFromExpression(
  expression: Node,
  startIndex: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (Node.isArrayLiteralExpression(expression)) {
    return extractArrayRestFromArrayLiteral(expression, startIndex, bindings);
  }

  if (Node.isIdentifier(expression)) {
    const arrayDefinitions = findIdentifierDefinitions(expression, bindings);
    const restTargets = arrayDefinitions.flatMap(definition =>
      extractArrayRestFromTarget(definition, startIndex)
    );

    return restTargets.length > 0
      ? restTargets
      : [toTarget(expression, bindings, "property", "Array rest source")];
  }

  if (Node.isCallExpression(expression)) {
    const callTargets = findArrayMethodReturnValues(expression, bindings);
    if (callTargets.length > 0) return callTargets;

    return findCallReturnValues(expression, bindings).flatMap(target =>
      extractArrayRestFromTarget(target, startIndex)
    );
  }

  return [toTarget(expression, bindings, "property", "Array rest source")];
}

function extractArrayRestFromArrayLiteral(
  arrayLiteral: Node,
  startIndex: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isArrayLiteralExpression(arrayLiteral)) return [];

  const targets: TraceTarget[] = [];
  let position = 0;

  for (const element of arrayLiteral.getElements()) {
    if (Node.isSpreadElement(element)) {
      targets.push(toTarget(element.getExpression(), bindings, "property", "Array spread source for rest"));
      continue;
    }

    if (position >= startIndex) {
      targets.push(toTarget(element, bindings, "parameter", "Array rest element"));
    }

    position += 1;
  }

  return dedupeTargets(targets);
}