import { Node } from "ts-morph";
import { isTerminalValue } from "../nodeUtils";
import { TraceTarget } from "./types";
import { findIdentifierDefinitions } from "./identifiers";
import { findElementAccessSources } from "./elementAccess";
import { findCallReturnValues } from "./callExpressions";
import { findReturnedValueSources, findExpressionSources } from "./expressions";
import { findParameterArguments } from "./parameters";
import { findBindingElementSources } from "./bindingElements";
import { findPropertyAccessSources } from "./props/access";

export function findDefinitions(target: TraceTarget): TraceTarget[] {
  const { node } = target;

  if (isTerminalValue(node)) return [];
  if (Node.isIdentifier(node)) return findIdentifierDefinitions(node, target.bindings);
  if (Node.isPropertyAccessExpression(node)) return findPropertyAccessSources(node, target.bindings);
  if (Node.isElementAccessExpression(node)) return findElementAccessSources(node, target.bindings);
  if (Node.isCallExpression(node)) return findCallReturnValues(node, target.bindings);
  if (Node.isReturnStatement(node)) return findReturnedValueSources(node, target.bindings);
  if (Node.isParameterDeclaration(node)) return findParameterArguments(node, target.bindings);
  if (Node.isBindingElement(node)) return findBindingElementSources(node, target.bindings);

  return findExpressionSources(node, target.bindings);
}