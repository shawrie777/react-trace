import * as assert from "assert";
import { Project, SourceFile, SyntaxKind } from "ts-morph";
import { trace } from "../traceEngine";
import { GraphNode } from "../traceTypes";

suite("Trace engine", () => {
  test("prefers the last straight-line assignment", async () => {
    const graph = await traceIdentifier(`
      function test() {
        let foo;
        foo = 1;
        foo = 2;
        return foo;
      }
    `, "foo");

    assert.ok(graph);
    assert.deepStrictEqual(
      graph.children.map(child => child.preview),
      ["foo = 2;"]
    );
  });

  test("keeps both if/else assignments", async () => {
    const graph = await traceIdentifier(`
      function test(condition: boolean) {
        let foo;
        if (condition) {
          foo = 1;
        } else {
          foo = 2;
        }
        return foo;
      }
    `, "foo");

    assert.ok(graph);
    assert.deepStrictEqual(
      graph.children.map(child => child.preview).sort(),
      ["foo = 1;", "foo = 2;"]
    );
  });

  test("binds function parameters to the specific call argument", async () => {
    const graph = await traceIdentifier(`
      function test() {
        let foo;
        let bar = 1;
        foo = other(bar);
        return foo;
      }

      function other(b: number) {
        return 4 * b;
      }
    `, "foo");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).includes("let bar = 1;"));
  });

  test("uses parameter defaults when call sites omit the argument", async () => {
    const graph = await traceIdentifier(`
      function other(value = 5) {
        return value;
      }

      function test() {
        return other();
      }
    `, "value");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).some(preview => preview.includes("value = 5")));
  });

  test("uses destructuring defaults when props omit the value", async () => {
    const graph = await traceIdentifier(`
      function Child({foo = 3}: {foo?: number}) {
        return foo;
      }

      function App() {
        return <Child />;
      }
    `, "foo");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).some(preview => preview.includes("foo = 3")));
  });

  test("uses destructuring defaults when an object property is missing", async () => {
    const graph = await traceIdentifier(`
      function test() {
        const source = {};
        const {foo = 3} = source;
        return foo;
      }
    `, "foo");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).some(preview => preview.includes("foo = 3")));
  });

  test("traces useState initial values and setter updates", async () => {
    const graph = await traceIdentifier(`
      declare function useState<T>(value: T): [T, (value: T) => void];

      function Component() {
        const [value, setValue] = useState(1);
        setValue(2);
        return value;
      }
    `, "value");

    assert.ok(graph);
    const previews = flattenPreviews(graph);

    assert.ok(previews.includes("const [value, setValue] = useState(1);"));
    assert.ok(previews.includes("setValue(2);"));
  });

  test("traces props through memo-wrapped anonymous components", async () => {
    const graph = await traceIdentifier(`
      declare function memo<T>(value: T): T;

      function App() {
        const source = 8;
        return <Child foo={source} />;
      }

      const Child = memo(({foo}: {foo: number}) => {
        return foo;
      });
    `, "foo");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).includes("const source = 8;"));
  });

  test("traces props through default imports from barrel modules", async () => {
    const graph = await traceIdentifierInProject({
      "Child.tsx": `
        export default function ({foo}: {foo: number}) {
          return foo;
        }
      `,
      "index.ts": `
        export { default } from "./Child";
      `,
      "App.tsx": `
        import Child from "./index";

        function App() {
          const source = 9;
          return <Child foo={source} />;
        }
      `,
    }, "Child.tsx", "foo");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).includes("const source = 9;"));
  });

  test("traces JSX object rest props while omitting destructured props", async () => {
    const graph = await traceIdentifier(`
      function Child({skip, ...rest}: {skip: number; keep: number}) {
        const restValue = rest.keep;
        return restValue;
      }

      function App() {
        const skip = 1;
        const keep = 10;
        return <Child skip={skip} keep={keep} />;
      }
    `, "restValue");

    const previews = flattenPreviews(assertGraph(graph));

    assert.ok(previews.includes("const keep = 10;"));
    assert.ok(!previews.includes("const skip = 1;"));
  });

  test("respects later object properties over earlier spreads", async () => {
    const graph = await traceIdentifier(`
      function test() {
        const first = 1;
        const second = 2;
        const source = {...{foo: first}, foo: second};
        return source.foo;
      }
    `, "foo");

    const previews = flattenPreviews(assertGraph(graph));

    assert.ok(previews.includes("const second = 2;"));
    assert.ok(!previews.includes("const first = 1;"));
  });

  test("traces array map results through indexed access", async () => {
    const graph = await traceIdentifier(`
      function test() {
        const source = 11;
        const rows = [{value: source}];
        const mapped = rows.map(row => row.value);
        return mapped[0];
      }
    `, "mapped");

    assert.ok(graph);
    assert.ok(flattenPreviews(graph).includes("const source = 11;"));
  });

  test("traces array rest values through indexed access", async () => {
    const graph = await traceIdentifier(`
      function test() {
        const first = 1;
        const second = 12;
        const items = [first, second];
        const [, ...rest] = items;
        return rest[0];
      }
    `, "rest");

    const previews = flattenPreviews(assertGraph(graph));

    assert.ok(previews.includes("const second = 12;"));
    assert.ok(!previews.includes("const first = 1;"));
  });

  test("uses finally assignments as the current value after try/catch", async () => {
    const graph = await traceIdentifier(`
      function test() {
        let foo;
        try {
          foo = 1;
        } catch {
          foo = 2;
        } finally {
          foo = 3;
        }
        return foo;
      }
    `, "foo");

    assert.ok(graph);
    assert.deepStrictEqual(
      graph.children.map(child => child.preview),
      ["foo = 3;"]
    );
  });

  test("marks network calls as external boundary nodes", async () => {
    const graph = await traceIdentifier(`
      function test() {
        const value = fetch("/api/user");
        return value;
      }
    `, "value");

    const fetchNode = assertGraph(graph).children.find(child =>
      child.preview.includes("fetch")
    );

    assert.ok(fetchNode);
    assert.strictEqual(fetchNode.kind, "external");
    assert.strictEqual(fetchNode.note, "Backend/network boundary");
  });
});

async function traceIdentifier(code: string, name: string): Promise<GraphNode | undefined> {
  const project = new Project();
  const sourceFile = project.createSourceFile("test.tsx", code);
  return traceIdentifierInSourceFile(sourceFile, name);
}

async function traceIdentifierInProject(
  files: Record<string, string>,
  targetFile: string,
  name: string
): Promise<GraphNode | undefined> {
  const project = new Project();

  for (const [filePath, code] of Object.entries(files)) {
    project.createSourceFile(filePath, code);
  }

  return traceIdentifierInSourceFile(project.getSourceFileOrThrow(targetFile), name);
}

async function traceIdentifierInSourceFile(
  sourceFile: SourceFile,
  name: string
): Promise<GraphNode | undefined> {
  const identifier = sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter(node => node.getText() === name)
    .at(-1);

  assert.ok(identifier);
  return trace({node: identifier, bindings: new Map()});
}

function assertGraph(graph: GraphNode | undefined): GraphNode {
  assert.ok(graph);
  return graph;
}

function flattenPreviews(node: GraphNode): string[] {
  return [
    node.preview,
    ...node.children.flatMap(flattenPreviews),
  ];
}
