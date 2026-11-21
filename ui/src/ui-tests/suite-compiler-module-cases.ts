import { flushSync } from "react-dom";
import * as React from "react";
import * as launcher from "../launcher/public/index";
import * as foundation from "../ui-foundation/index";

import {
  compileSuite,
  compileSuiteInScope,
  loadPublicModules,
} from "../ui-suite/compiler";
import { createSuiteRuntimeScope } from "../ui-suite/prepared";

import { source, make } from "./suite-compiler-support";
import type { CompilerFixtureContext } from "./suite-compiler-support";

export async function checkRelativeModules(context: CompilerFixtureContext) {
  const { assert, check, host, keep, render } = context;
  await check("relative_modules_reexports_and_cjs_cycle", async () => {
    const p = keep(
      await compileSuite(
        await make({
          "Home.tsx": source(
            "import {label} from './barrel'; import {partial} from './cycle'; export const later='ready'; export default ()=><div data-testid='result'>{label}:{String(partial)}</div>",
          ),
          "barrel.ts": source("export {label} from './lib';"),
          "lib/index.ts": source("export const label='helper-ok'"),
          "cycle.ts": source(
            "import {later} from './Home';export const partial=later",
          ),
        }),
      ),
    );
    render(p);
    assert(
      host.textContent === "helper-ok:undefined",
      "named exports and CJS partial export",
    );
    const a = keep(
      await compileSuite(
        await make({ "Home.tsx": source("export default ()=><p>a</p>") }),
      ),
    );
    const b = keep(
      await compileSuite(
        await make({ "Home.tsx": source("export default ()=><p>b</p>") }),
      ),
    );
    render(a);
    assert(host.textContent === "a", "suite A isolation");
    render(b);
    assert(host.textContent === "b", "suite B isolation");
  });
}

export async function checkDependencyAndCssState(
  context: CompilerFixtureContext,
) {
  const { assert, check, host, keep, render } = context;
  await check("dependency_change_vs_css_state", async () => {
    const scope = createSuiteRuntimeScope();
    const files = {
      "Home.tsx": source(
        "import {useState} from 'react';import {label} from './helper';import './style.css';export default function View(){const [text,setText]=useState('');return <div><input aria-label='suite input' value={text} onInput={e=>setText(e.currentTarget.value)}/><b>{label}</b></div>}",
      ),
      "helper.ts": source("export const label='old helper'"),
      "style.css": source("input{color:rgb(1,2,3)}"),
    };
    const p = keep(await compileSuiteInScope(await make(files), scope));
    render(p);
    const input = host.querySelector("input")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "typed value");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const next = keep(
      await compileSuiteInScope(
        await make({
          ...files,
          "style.css": source("input{color:rgb(4,5,6)}"),
        }),
        scope,
      ),
    );
    assert(
      p.views.get("page.home") === next.views.get("page.home"),
      "CSS update component identity",
    );
    render(next);
    p.dispose();
    assert(
      host.querySelector("input") === input && input.value === "typed value",
      "typed value survives CSS preview",
    );
    const changed = keep(
      await compileSuiteInScope(
        await make({
          ...files,
          "helper.ts": source("export const label='new helper'"),
        }),
        scope,
      ),
    );
    assert(
      changed.views.get("page.home") !== next.views.get("page.home"),
      "helper changes component",
    );
    render(changed);
    assert(host.textContent === "new helper", "new helper execution");
  });
}

export async function checkDeferredInitialization(
  context: CompilerFixtureContext,
) {
  const { assert, rejects, check } = context;
  await check("validation_cancellation_and_deferred_initialize", async () => {
    (globalThis as Record<string, unknown>).__suiteExecuted = 0;
    const bundle = await make({
      "Home.tsx": source("globalThis.__suiteExecuted++;export default()=>null"),
    });
    const stale = structuredClone(bundle);
    stale.files["Home.tsx"] = source("globalThis.__suiteExecuted++");
    await rejects(() => compileSuite(stale));
    assert(
      (globalThis as Record<string, unknown>).__suiteExecuted === 0,
      "strict hash gate before executable",
    );
    const controller = new AbortController();
    controller.abort();
    await rejects(() => compileSuite(bundle, controller.signal));
    let current = true;
    const tracked = Object.getOwnPropertyDescriptor(URL, "createObjectURL")!
      .value as typeof URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      const url = tracked(blob);
      if (blob instanceof Blob && blob.type === "text/javascript")
        current = false;
      return url;
    };
    try {
      await rejects(
        () =>
          compileSuiteInScope(bundle, createSuiteRuntimeScope(), {
            isCurrent: () => current,
          }),
        /Abort|current|supersed/i,
      );
    } finally {
      URL.createObjectURL = tracked;
    }
    assert(
      (globalThis as Record<string, unknown>).__suiteExecuted === 0,
      "await import completes before ownership guarded initialize",
    );
  });
}

export async function checkPublicModulePolicy(context: CompilerFixtureContext) {
  const { assert, rejects, check } = context;
  await check("public_module_identity_and_policy", async () => {
    const m = loadPublicModules();
    assert(
      (m.react as typeof React).useState === React.useState,
      "React hook identity",
    );
    assert(m["@paradox/launcher"] === launcher, "launcher namespace identity");
    assert(m["@paradox/ui"] === foundation, "foundation namespace identity");
    assert(
      Object.keys(m).length === 6 && !("LauncherProvider" in launcher),
      "whitelist/private provider",
    );
    for (const text of [
      "import type {A} from './missing';export default()=>null",
      "import('react')",
      "require('react')",
      "await Promise.resolve()",
      "import.meta.url",
    ])
      await rejects(
        async () => compileSuite(await make({ "Home.tsx": source(text) })),
        /Home\.tsx:\d+:\d+:/,
      );
  });
}
