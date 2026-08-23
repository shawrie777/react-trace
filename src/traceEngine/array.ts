import { Node, CallExpression, BindingElement } from "ts-morph";
import { TraceTarget, FunctionLike } from "./types";
import { getFunctionLikesFromExpression } from "./functions";
import { bindingElementHasRestToken, dedupeTargets, getReturnTargets, toTarget, withInitializerFallback } from "./utils";
import { getNodeId } from "../nodeUtils";
import { findReduceReturnValues, findCallReturnValues, findCallSiteArguments, getCallName } from "./callExpressions";
import { findIdentifierDefinitions } from "./identifiers";
import { findExpressionSources } from "./returns";
import { findUseReducerSources, findUseStateSources } from "./hooks";

export function findArrayMethodReturnValues(
  call: CallExpression,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return [];

  const methodName = expression.getName();
  const receiver = expression.getExpression();

  if (methodName === "map" || methodName === "flatMap") {
    const callback = call.getArguments()[0];
    if (!callback) return [];

    const functionLikes = getFunctionLikesFromExpression(callback);
    if (functionLikes.length === 0) return [];

    return findArrayElementCandidateSources(receiver, bindings)
      .flatMap(elementTarget => functionLikes.flatMap(functionLike => {
        const callbackContext = createArrayCallbackContext(
          functionLike,
          elementTarget,
          receiver,
          bindings
        );

        return getReturnTargets(functionLike, callbackContext).map(target => ({
          ...target,
          note: target.note ?? `Array ${methodName} callback return`,
        }));
      }));
  }

  if (methodName === "reduce") {
    return findReduceReturnValues(call, receiver, bindings);
  }

  if (methodName === "find") {
    return findArrayElementCandidateSources(receiver, bindings).map(target => ({
      ...target,
      note: target.note ?? "Array find result",
    }));
  }

  if (
    ["filter", "slice", "toReversed", "toSorted", "toSpliced", "reverse", "sort"].includes(methodName)
  ) {
    return findArrayElementCandidateSources(receiver, bindings).map(target => ({
      ...target,
      note: target.note ?? `Array ${methodName} preserves source elements`,
    }));
  }

  if (methodName === "concat") {
    return [
      ...findArrayElementCandidateSources(receiver, bindings),
      ...call.getArguments().flatMap(argument =>
        findArrayElementCandidateSources(argument, bindings)
      ),
    ];
  }

  return [];
}

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

function createArrayCallbackContext(
  functionLike: FunctionLike,
  elementTarget: TraceTarget,
  receiver: Node,
  oldBindings: Map<string, TraceTarget>
): Map<string, TraceTarget> {
  const bindings = new Map(oldBindings);
  const [elementParameter, indexParameter, arrayParameter] = functionLike.getParameters();

  if (elementParameter) {
    bindings.set(getNodeId(elementParameter), elementTarget);
  }

  if (indexParameter) {
    bindings.set(getNodeId(indexParameter), toTarget(receiver, oldBindings, "parameter", "Array callback index"));
  }

  if (arrayParameter) {
    bindings.set(getNodeId(arrayParameter), toTarget(receiver, oldBindings, "parameter", "Array callback source"));
  }

  return bindings;
}

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

  if (bindingElementHasRestToken(bindingElement)) {
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

function extractArrayElementFromTarget(target: TraceTarget, index: number): TraceTarget[] {
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

function findArrayRestBindingElementSources(
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

export function getArrayBindingElement(bindingPattern: Node, index: number): BindingElement | undefined {
  if (!Node.isArrayBindingPattern(bindingPattern)) return undefined;

  const element = bindingPattern.getElements()[index];
  return Node.isBindingElement(element) ? element : undefined;
}