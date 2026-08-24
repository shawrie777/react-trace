import { Identifier, Node, PropertyAccessExpression } from "ts-morph";
import { TraceTarget } from "../types";
import { findLocalReachingPropertyDefinitions } from "./assignments";
import { findPropertySourcesForExpression } from "./sources";

export function findPropertyAccessSources(
  propertyAccess: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const reaching = findLocalReachingPropertyDefinitions(propertyAccess, bindings);
  if (reaching.length > 0) return reaching;

  return findPropertySourcesForExpression(
    propertyAccess.getExpression(),
    propertyAccess.getName(),
    bindings
  );
}

export function getPropertyAccessNameParent(node: Identifier): PropertyAccessExpression | undefined {
  const parent = node.getParent();

  if (
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === node
  ) {
    return parent;
  }

  return undefined;
}