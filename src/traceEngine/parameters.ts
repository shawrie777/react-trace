import { Node, Identifier, ParameterDeclaration } from "ts-morph";
import { getNodeId } from "../nodeUtils";
import { TraceTarget } from "./types";
import { findCallSiteArguments } from "./callExpressions";
import { findReactPropsObjectArguments } from "./props";
import { withInitializerFallback } from "./utils";

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