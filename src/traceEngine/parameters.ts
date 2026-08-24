import { Node, Identifier, ParameterDeclaration } from "ts-morph";
import { getNodeId } from "../nodeUtils";
import { TraceTarget } from "./types";
import { toTarget, withInitializerFallback } from "./utils";
import { getParameterFunction, getFunctionNameNode } from "./functions";
import { findReactPropsObjectArguments } from "./props/jsx";

export function getParameterDeclarationForIdentifier(node: Identifier): ParameterDeclaration | undefined {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];

  return declarations.find((declaration): declaration is ParameterDeclaration =>
    Node.isParameterDeclaration(declaration)
  );
}

export function findParameterArguments(
  parameter: ParameterDeclaration,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const boundArgument = bindings.get(getNodeId(parameter));
  if (boundArgument) return [boundArgument];

  const argumentsFromCallSites = [
    ...findCallSiteArguments(parameter, bindings),
    ...findReactPropsObjectArguments(parameter, bindings),
  ];

  return withInitializerFallback(
    argumentsFromCallSites,
    parameter.getInitializer(),
    bindings,
    "parameter",
    "Parameter default value"
  );
}

export function findCallSiteArguments(
  parameter: ParameterDeclaration,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);
  const nameNode = getFunctionNameNode(functionLike);
  if (!functionLike || !nameNode) return [];

  const parameterIndex = functionLike.getParameters().findIndex(candidate => candidate === parameter);
  if (parameterIndex === -1) return [];

  return nameNode
    .findReferencesAsNodes()
    .flatMap(ref => {
      const parent = ref.getParent();

      if (
        Node.isCallExpression(parent) &&
        parent.getExpression() === ref
      ) {
        const arg = parent.getArguments()[parameterIndex];
        return arg ? [toTarget(arg, bindings, "parameter")] : [];
      }

      return [];
    });
}