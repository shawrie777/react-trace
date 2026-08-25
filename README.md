# React-Trace

React-Trace is a VS Code extension for exploring where a selected value may have come from.

Right click an identifier in a TypeScript or TSX file, run **Trace Variable Origin**, and React-Trace builds a graph of possible source paths. The aim is to answer questions like: "where could this value have been assigned, passed from, returned from, or derived from?"

This is an early version, built mainly for React projects.

## Features

- Trace selected identifiers from the editor context menu, Command Palette, or `Ctrl+Shift+T`.
- Render possible value origins as a left-to-right graph in the **Variable Trace** panel.
- Click graph nodes to jump to the related source line.
- Hover graph nodes to see file, line, kind, and trace notes.
- Follow local assignments, conditional branches, function returns, call arguments, callback parameters, and imported declarations.
- Handle common React patterns, including component props, destructured props, rest props, `useState`, `useReducer`, `useContext`, `useMemo`, and `useCallback`.
- Understand common object and array flows, including property access, element access, spreads, rest bindings, and array methods such as `map`, `filter`, `find`, `reduce`, `slice`, and `concat`.
- Stop at useful boundaries such as backend/network calls, browser storage, routing hooks, data hooks, environment/config reads, and dynamic external calls.

## Usage

1. Open a TypeScript or TSX file in a workspace that has a `tsconfig.json`.
2. Place the cursor on the identifier you want to trace.
3. Run **Trace Variable Origin**.

You can run the command in three ways:

- Right click in the editor and choose **Trace Variable Origin**.
- Open the Command Palette and run **Trace Variable Origin**.
- Press `Ctrl+Shift+T`.

The result appears in the **Variable Trace** panel. Each node represents a possible value source or step in the trace. Multiple branches may merge when they ultimately point to the same source node.

## Requirements

- VS Code compatible with the extension engine version in `package.json`.
- A TypeScript or TSX workspace with a discoverable `tsconfig.json`.
- Project dependencies installed with `npm install` before building from source.

React-Trace currently uses the first workspace folder and searches for the shallowest `tsconfig.json`, skipping hidden folders and `node_modules`.

## Development

Install dependencies:

```sh
npm install
```

Compile:

```sh
npm run compile
```

Run lint:

```sh
npm run lint
```

Run tests:

```sh
npm test
```

For extension development, use VS Code's extension debugging flow. If stale compiled files cause odd behavior while testing, delete `out` and compile again.

## Packaging

Package a VSIX with:

```sh
vsce package
```

On Windows PowerShell, if the `vsce` shim is blocked by execution policy, use:

```sh
vsce.cmd package
```

If `vsce` is not installed:

```sh
npm install -g @vscode/vsce
```

## Current Limitations

- This is a best-effort static trace, not a full TypeScript control-flow engine.
- Some dynamic property access, higher-order function patterns, mutation-heavy flows, and framework-specific conventions may be incomplete.
- The graph layout is intentionally simple and may draw crossing or overlapping edges in complex traces.
- Large traces are capped by maximum depth and node count to avoid runaway recursion.
- The first version is tuned for React/TypeScript projects and may need more work for non-React codebases or complex monorepos.

## Extension Settings

React-Trace does not currently contribute any user settings.

## Release Notes

### 0.0.1

Initial experimental release.
