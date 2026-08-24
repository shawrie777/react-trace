import { Identifier } from "ts-morph";
import { TraceTarget } from "./types";
import { getParameterDeclarationForIdentifier } from "./parameters";
import { getContainingStatement } from "./relatedNodes";
import { toTarget } from "./utils";
import { findDeclarationInitializers } from "./declarations";
import { getBindingElementDeclarationForIdentifier } from "./bindingElements";
import { scanOutwardForReachingDefinitions } from "./defScan";
import { getPropertyAccessNameParent, findPropertyAccessSources } from "./props/access";

export function findIdentifierDefinitions(node: Identifier, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const propertyAccess = getPropertyAccessNameParent(node);
  if (propertyAccess) return findPropertyAccessSources(propertyAccess, bindings);

  const parameter = getParameterDeclarationForIdentifier(node);
  if (parameter) {
    return [toTarget(parameter, bindings, "parameter")];
  }

  const bindingElement = getBindingElementDeclarationForIdentifier(node);
  if (bindingElement) {
    return [toTarget(bindingElement, bindings, "parameter")];
  }

  const reaching = findLocalReachingDefinitions(node, bindings);
  if (reaching.length > 0) return reaching;

  return findDeclarationInitializers(node, bindings);
}

function findLocalReachingDefinitions(identifier: Identifier, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const statement = getContainingStatement(identifier);
  if (!statement) return [];

  return scanOutwardForReachingDefinitions(statement, identifier, bindings).targets;
}