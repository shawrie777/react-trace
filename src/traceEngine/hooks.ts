import { Node, CallExpression, BindingElement } from "ts-morph";
import { GraphNodeKind } from "../traceTypes";
import { TraceTarget } from "./types";
import { findIdentifierDefinitions } from "./identifiers";
import { isCallNamed } from "./callExpressions";
import { getBindingElementIdentifier, toTarget } from "./utils";
import { getArrayBindingElement } from "./arrays";
import { getNodeId } from "../nodeUtils";
import { bindFirstParameterToTarget, getFunctionLikesFromExpression } from "./functions";
import { getReturnTargets } from "./expressions";
import { getJsxPropTargets } from "./props/jsx";

export function findUseContextValues(call: CallExpression, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const contextArg = call.getArguments()[0];
  if (!contextArg) return [];

  const providerValues = findContextProviderValues(contextArg, bindings);
  if (providerValues.length > 0) return providerValues;

  return findCreateContextDefaultValues(contextArg, bindings);
}

function findContextProviderValues(
  contextExpression: Node,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isIdentifier(contextExpression)) return [];

  return contextExpression
    .findReferencesAsNodes()
    .flatMap(ref => {
      const propertyAccess = ref.getParent();

      if (
        !Node.isPropertyAccessExpression(propertyAccess) ||
        propertyAccess.getExpression() !== ref ||
        propertyAccess.getName() !== "Provider"
      ) {
        return [];
      }

      const jsxElement = propertyAccess.getParent();

      if (
        (Node.isJsxSelfClosingElement(jsxElement) || Node.isJsxOpeningElement(jsxElement)) &&
        jsxElement.getTagNameNode() === propertyAccess
      ) {
        return getJsxPropTargets(jsxElement, "value", bindings)
          .map(target => ({
            ...target,
            kind: "context" as GraphNodeKind,
            note: target.note ?? "React context provider value",
          }));
      }

      return [];
    });
}

function findCreateContextDefaultValues(
  contextExpression: Node,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isIdentifier(contextExpression)) return [];

  return findIdentifierDefinitions(contextExpression, bindings)
    .filter(target => Node.isCallExpression(target.node) && isCallNamed(target.node, ["createContext"]))
    .flatMap(target => {
      if (!Node.isCallExpression(target.node)) return [];

      const defaultValue = target.node.getArguments()[0];
      return defaultValue
        ? [toTarget(defaultValue, bindings, "context", "createContext default value")]
        : [];
    });
}

export function findUseStateSources(
  call: CallExpression,
  bindingPattern: Node,
  index: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isArrayBindingPattern(bindingPattern)) return [];

  if (index === 1) {
    return [toTarget(call, bindings, "hook", "useState setter")];
  }

  if (index !== 0) return [];

  const stateElement = getArrayBindingElement(bindingPattern, 0);
  const setterElement = getArrayBindingElement(bindingPattern, 1);
  const initializer = call.getArguments()[0];

  return [
    ...(initializer ? [toTarget(initializer, bindings, "state", "Initial useState value")] : []),
    ...(stateElement && setterElement
      ? findUseStateSetterUpdates(stateElement, setterElement, bindings)
      : []),
  ];
}

export function findUseReducerSources(
  call: CallExpression,
  bindingPattern: Node,
  index: number,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isArrayBindingPattern(bindingPattern)) return [];

  if (index === 1) {
    return [toTarget(call, bindings, "hook", "useReducer dispatch")];
  }

  if (index !== 0) return [];

  const stateElement = getArrayBindingElement(bindingPattern, 0);
  const dispatchElement = getArrayBindingElement(bindingPattern, 1);
  const reducer = call.getArguments()[0];
  const initialArg = call.getArguments()[1];
  const initializer = call.getArguments()[2];

  return [
    ...(initializer
      ? [toTarget(initializer, bindings, "state", "useReducer initializer")]
      : []),
    ...(initialArg
      ? [toTarget(initialArg, bindings, "state", "Initial useReducer state")]
      : []),
    ...(stateElement && dispatchElement && reducer
      ? findUseReducerDispatchUpdates(reducer, stateElement, dispatchElement, bindings)
      : []),
  ];
}

function findUseStateSetterUpdates(
  stateElement: BindingElement,
  setterElement: BindingElement,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const setterIdentifier = getBindingElementIdentifier(setterElement);
  if (!setterIdentifier) return [];

  return setterIdentifier
    .findReferencesAsNodes()
    .flatMap(ref => {
      const parent = ref.getParent();

      if (!Node.isCallExpression(parent) || parent.getExpression() !== ref) {
        return [];
      }

      const updateArgument = parent.getArguments()[0];
      if (!updateArgument) return [];

      if (Node.isArrowFunction(updateArgument) || Node.isFunctionExpression(updateArgument)) {
        const updateContext = bindFirstParameterToTarget(
          updateArgument,
          toTarget(stateElement, bindings, "state", "Previous state value"),
          bindings
        );

        return getReturnTargets(updateArgument, updateContext);
      }

      return [toTarget(updateArgument, bindings, "state", "useState setter value")];
    });
}

function findUseReducerDispatchUpdates(
  reducerExpression: Node,
  stateElement: BindingElement,
  dispatchElement: BindingElement,
  oldBindings: Map<string, TraceTarget>
): TraceTarget[] {
  const dispatchIdentifier = getBindingElementIdentifier(dispatchElement);
  if (!dispatchIdentifier) return [];

  const reducers = getFunctionLikesFromExpression(reducerExpression);
  if (reducers.length === 0) return [];

  return dispatchIdentifier
    .findReferencesAsNodes()
    .flatMap(ref => {
      const parent = ref.getParent();

      if (!Node.isCallExpression(parent) || parent.getExpression() !== ref) {
        return [];
      }

      const action = parent.getArguments()[0];

      return reducers.flatMap(reducer => {
        const bindings = new Map(oldBindings);
        const [stateParameter, actionParameter] = reducer.getParameters();

        if (stateParameter) {
          bindings.set(
            getNodeId(stateParameter),
            toTarget(stateElement, oldBindings, "state", "Previous reducer state")
          );
        }

        if (stateParameter && actionParameter && action) {
          bindings.set(
            getNodeId(actionParameter),
            toTarget(action, oldBindings, "parameter", "Action passed to dispatch")
          );
        }

        return getReturnTargets(reducer, bindings);
      });
    });
}