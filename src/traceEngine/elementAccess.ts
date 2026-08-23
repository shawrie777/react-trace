import { Node } from "ts-morph";
import { TraceTarget } from "./types";
import { findArrayElementSourcesForExpression } from "./array";
import { findPropertySourcesForExpression } from "./props";
import { findExpressionSources } from "./returns";
import { toTarget } from "./utils";

export function findElementAccessSources(
  elementAccess: Node,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isElementAccessExpression(elementAccess)) return [];

  const argument = elementAccess.getArgumentExpression();
  const propertyName = argument ? getStaticElementAccessName(argument) : undefined;
  const elementIndex = argument ? getStaticElementAccessIndex(argument) : undefined;

  if (elementIndex !== undefined) {
    const arrayTargets = findArrayElementSourcesForExpression(
      elementAccess.getExpression(),
      elementIndex,
      bindings
    );

    if (arrayTargets.length > 0) return arrayTargets;
  }

  if (propertyName) {
    return findPropertySourcesForExpression(
      elementAccess.getExpression(),
      propertyName,
      bindings
    );
  }

  return [
    ...findExpressionSources(elementAccess.getExpression(), bindings),
    ...(argument
      ? [toTarget(argument, bindings, "unknown", "Dynamic property key")]
      : []),
  ];
}

export function getStaticElementAccessName(argument: Node): string | undefined {
  if (Node.isStringLiteral(argument) || Node.isNumericLiteral(argument)) {
    return argument.getLiteralText();
  }

  return undefined;
}

function getStaticElementAccessIndex(argument: Node): number | undefined {
  const name = getStaticElementAccessName(argument);
  if (name === undefined || !/^\d+$/.test(name)) return undefined;

  return Number(name);
}