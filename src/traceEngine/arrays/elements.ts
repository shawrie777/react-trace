import { CallExpression, Node } from "ts-morph";
import { findCallReturnValues } from "../callExpressions";
import { findExpressionSources } from "../expressions";
import { findIdentifierDefinitions } from "../identifiers";
import { TraceTarget } from "../types";
import { dedupeTargets, toTarget } from "../utils";
import { findArrayMethodReturnValues } from "./methods";

export function findArrayElementSourcesForExpression(
  expression: Node,
  index: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (Node.isArrayLiteralExpression(expression)) {
    return findArrayLiteralElementSources(expression, index, bindings);
  }

  if (Node.isIdentifier(expression)) {
    const arrayDefinitions = findIdentifierDefinitions(expression, bindings);
    const elementTargets = arrayDefinitions.flatMap(definition =>
      extractArrayElementFromTarget(definition, index)
    );

    return elementTargets.length > 0 ? elementTargets : arrayDefinitions;
  }

  if (Node.isCallExpression(expression)) {
    const callTargets = findArrayCallElementSources(expression, index, bindings);
    if (callTargets.length > 0) return callTargets;

    return findCallReturnValues(expression, bindings).flatMap(target =>
      extractArrayElementFromTarget(target, index)
    );
  }

  if (Node.isReturnStatement(expression)) {
    const returnedExpression = expression.getExpression();
    return returnedExpression
      ? findArrayElementSourcesForExpression(returnedExpression, index, bindings)
      : [];
  }

  return findExpressionSources(expression, bindings);
}

export function extractArrayElementFromTarget(target: TraceTarget, index: number): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isArrayLiteralExpression(node)) {
    return findArrayLiteralElementSources(node, index, context);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? findArrayElementSourcesForExpression(expression, index, context)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findArrayCallElementSources(node, index, context);
  }

  if (Node.isIdentifier(node)) {
    return findArrayElementSourcesForExpression(node, index, context);
  }

  return [{ ...target, note: target.note ?? "Array element source" }];
}

function findArrayLiteralElementSources(
  arrayLiteral: Node,
  index: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isArrayLiteralExpression(arrayLiteral)) return [];

  const targets: TraceTarget[] = [];
  let position = 0;
  let hasUnboundedSpread = false;

  for (const element of arrayLiteral.getElements()) {
    if (Node.isSpreadElement(element)) {
      if (position <= index) {
        targets.push(toTarget(element.getExpression(), bindings, "property", "Array spread may contain this element"));
        hasUnboundedSpread = true;
      }

      continue;
    }

    if (!hasUnboundedSpread && position === index) {
      return [toTarget(element, bindings, "parameter")];
    }

    if (hasUnboundedSpread && position <= index) {
      targets.push(toTarget(element, bindings, "parameter", "Array element after spread may occupy this index"));
    }

    position += 1;
  }

  return dedupeTargets(targets);
}

function findArrayCallElementSources(
  call: CallExpression,
  index: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const arrayMethodTargets = findArrayMethodReturnValues(call, bindings);
  if (arrayMethodTargets.length > 0) return arrayMethodTargets;

  return findCallReturnValues(call, bindings).flatMap(target =>
    extractArrayElementFromTarget(target, index)
  );
}

export function findArrayElementCandidateSources(
  expression: Node,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().flatMap(element => {
      if (Node.isSpreadElement(element)) {
        return [toTarget(element.getExpression(), bindings, "property", "Array spread elements")];
      }

      return [toTarget(element, bindings, "parameter")];
    });
  }

  if (Node.isIdentifier(expression)) {
    const definitions = findIdentifierDefinitions(expression, bindings);
    const candidates = definitions.flatMap(definition =>
      extractArrayElementCandidatesFromTarget(definition)
    );

    return candidates.length > 0
      ? candidates
      : [toTarget(expression, bindings, "parameter", "Array source")];
  }

  if (Node.isCallExpression(expression)) {
    const callValues = findArrayMethodReturnValues(expression, bindings);
    return callValues.length > 0
      ? callValues
      : [toTarget(expression, bindings, "call", "Array call result")];
  }

  if (Node.isReturnStatement(expression)) {
    const returnedExpression = expression.getExpression();
    return returnedExpression
      ? findArrayElementCandidateSources(returnedExpression, bindings)
      : [];
  }

  return [toTarget(expression, bindings, "parameter", "Array source")];
}

function extractArrayElementCandidatesFromTarget(target: TraceTarget): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isArrayLiteralExpression(node)) {
    return findArrayElementCandidateSources(node, context);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? findArrayElementCandidateSources(expression, context)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findArrayElementCandidateSources(node, context);
  }

  return [{ ...target, note: target.note ?? "Array element candidate" }];
}