import { createElement } from "react";

import { flushSync } from "react-dom";
import type * as React from "react";

import assetFixtures from "../../scripts/fixtures/ui-suite/browser-assets.json";

import { normalizeDraftBundle } from "../ui-suite/bundle";
import { compileSuite } from "../ui-suite/compiler";

import type { UiViewProps } from "../ui-suite/prepared";

import { parseSuiteHtml, renderSuiteHtml } from "../customization/html";

import { source, make, viewProps } from "./suite-compiler-support";
import type { CompilerFixtureContext } from "./suite-compiler-support";

export async function checkHtmlEventProjections(
  context: CompilerFixtureContext,
) {
  const { assert, rejects, check, host, root, keep } = context;
  await check("html_resources_and_R6_event_projections", async () => {
    const png = assetFixtures.find((f) => f.media === "image/png")!;
    const b = await make({
      "view/Home.html": source(
        '<div><img src="../pixel.png#test" style="--image:url(../pixel.png);background-image:var(--image)"/><input data-ui-action="props.changed" data-ui-event="onInput" data-ui-args=\'[{"$prop":"event.value"}]\'/><ui-prop name="props.label"/></div>',
      ),
      "pixel.png": {
        encoding: "base64",
        media_type: png.media,
        data: png.data,
      },
    });
    for (const id of Object.keys(b.manifest.views))
      b.manifest.views[id] = "view/Home.html";
    for (const route of b.manifest.routes) route.entry = "view/Home.html";
    const p = keep(await compileSuite(await normalizeDraftBundle(b)));
    let value: unknown;
    flushSync(() =>
      root.render(
        createElement(p.views.get("page.home")!, {
          ...viewProps,
          props: {
            label: "HTML value",
            changed: (v: unknown) => {
              value = v;
            },
          },
        }),
      ),
    );
    const input = host.querySelector("input");
    assert(input, `HTML input missing: ${host.innerHTML}`);
    input!.value = "event value";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    assert(value === "event value", "actual HTML input event projection");
    const img = host.querySelector("img")!;
    await img.decode();
    assert(
      img.naturalWidth === 3 && img.src.endsWith("#test"),
      "relative image fragment preserved",
    );
    assert(
      img.style.getPropertyValue("--image").includes("blob:"),
      "inline custom resource AST",
    );
    const callback = (action: string, args?: string) => {
      const nodes = parseSuiteHtml(
        `<input data-ui-action="${action}" ${args === undefined ? "" : `data-ui-args='${args}'`}/>`,
        { sourcePath: "events.html", resolveAsset: (ref) => ref },
      );
      let received: unknown[] = [];
      const envelope = {
        ...viewProps,
        props: {
          call: (...v: unknown[]) => {
            received = v;
          },
        },
        actions: {
          call: (...v: unknown[]) => {
            received = v;
          },
        },
      } as unknown as UiViewProps;
      const element = (
        renderSuiteHtml(nodes, envelope) as React.ReactElement[]
      )[0];
      const invoke = (event: unknown) =>
        (element.props as { onClick: (event: unknown) => void }).onClick(event);
      return { invoke, received: () => received };
    };
    const event = {
      currentTarget: { value: "text", checked: true, valueAsNumber: 42 },
    };
    for (const action of ["props.call", "actions.call"]) {
      const omitted = callback(action);
      omitted.invoke(event);
      assert(
        omitted.received().length === (action.startsWith("props") ? 1 : 0),
        "omitted callback args",
      );
      const empty = callback(action, "[]");
      empty.invoke(event);
      assert(empty.received().length === 0, "explicit empty args");
    }
    const projected = callback(
      "props.call",
      '[{"$prop":"event.value"},{"$prop":"event.checked"},{"$prop":"event.valueAsNumber"},"literal"]',
    );
    projected.invoke(event);
    event.currentTarget.value = "later";
    assert(
      JSON.stringify(projected.received()) === '["text",true,42,"literal"]',
      "immutable event-time primitive values",
    );
    for (const invalid of [
      { currentTarget: {} },
      { currentTarget: { value: "ok", checked: true, valueAsNumber: NaN } },
    ]) {
      let failed = false;
      try {
        projected.invoke(invalid);
      } catch (e) {
        failed = /missing or invalid/.test(String(e));
      }
      assert(failed, "missing/non-finite event field diagnostics");
    }
    await rejects(
      () =>
        Promise.resolve().then(() =>
          parseSuiteHtml('<img src="./pixel.png?query"/>', {
            sourcePath: "image.html",
            resolveAsset: () => {
              throw Error("queries not supported");
            },
          }),
        ),
      /image.html/,
    );
  });
}
