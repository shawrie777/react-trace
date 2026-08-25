import { Node, CallExpression, BindingElement } from "ts-morph";
import { TraceTarget } from "../types";
import { toTarget, withInitializerFallback } from "../utils";
import { getNodeId } from "../../nodeUtils";
import { getCallName } from "../callExpressions";
import { findUseReducerSources, findUseStateSources } from "../hooks";
import { findCallSiteArguments } from "../parameters";
import { findArrayRestBindingElementSources } from "./rest";
import { extractArrayElementFromTarget, findArrayElementSourcesForExpression } from "./elements";

export function findArrayBindingElementSources(
  bindingElement: BindingElement,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const bindingPattern = bindingElement.getParent();
  if (!Node.isArrayBindingPattern(bindingPattern)) return [];

  const bindingOwner = bindingPattern.getParent();
  const index = bindingPattern.getElements().findIndex(element => element === bindingElement);
  if (index === -1) return [];
  const initializer = bindingElement.getInitializer();

  if (bindingElement.getDotDotDotToken()) {
    return findArrayRestBindingElementSources(bindingElement, index, bindings);
  }

  if (Node.isParameterDeclaration(bindingOwner)) {
    const boundArgument = bindings.get(getNodeId(bindingOwner));
    const sources = boundArgument
      ? extractArrayElementFromTarget(boundArgument, index)
      : findCallSiteArguments(bindingOwner, bindings)
          .flatMap(argument => extractArrayElementFromTarget(argument, index));

    return withInitializerFallback(
      sources,
      initializer,
      bindings,
      "parameter",
      "Array destructuring default value"
    );
  }

  if (!Node.isVariableDeclaration(bindingOwner)) {
    return withInitializerFallback([], initializer, bindings, "parameter", "Array destructuring default value");
  }

  const ownerInitializer = bindingOwner.getInitializer();
  if (!ownerInitializer) {
    return withInitializerFallback([], initializer, bindings, "parameter", "Array destructuring default value");
  }

  const hookSources = Node.isCallExpression(ownerInitializer)
    ? findHookArrayElementSources(ownerInitializer, bindingPattern, index, bindings)
    : [];
  const sources = hookSources.length > 0
    ? hookSources
    : findArrayElementSourcesForExpression(ownerInitializer, index, bindings);

  return withInitializerFallback(
    sources.length > 0
      ? sources
      : [toTarget(ownerInitializer, bindings, "parameter", "Array destructuring source")],
    initializer,
    bindings,
    "parameter",
    "Array destructuring default value"
  );
}

export function getArrayBindingElement(bindingPattern: Node, index: number): BindingElement | undefined {
  if (!Node.isArrayBindingPattern(bindingPattern)) return undefined;

  const element = bindingPattern.getElements()[index];
  return Node.isBindingElement(element) ? element : undefined;
}

function findHookArrayElementSources(
  call: CallExpression,
  bindingPattern: Node,
  index: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isArrayBindingPattern(bindingPattern)) return [];

  const callName = getCallName(call);

  if (callName === "useState") {
    return findUseStateSources(call, bindingPattern, index, bindings);
  }

  if (callName === "useReducer") {
    return findUseReducerSources(call, bindingPattern, index, bindings);
  }

  return [];
}