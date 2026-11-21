import type { CssFixtureContext } from "./suite-compiler-support";

export function checkAnimationGrammar(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix1_animation_grammar_global_target_inline", () => {
    for (const target of [false, true]) {
      const row = sample(
        "@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}.probe{animation:fade 1s linear}",
        undefined,
        target,
      );
      try {
        const node = row.element.querySelector<HTMLElement>(".probe")!;
        assert(
          getComputedStyle(node).animationName ===
            "suite-fix1browser-animation-1" &&
            getComputedStyle(node).animationTimingFunction === "linear",
          "shorthand timing preserved",
        );
        row.inline(node, { animation: "linear 1s linear" });
        assert(
          getComputedStyle(node).animationName ===
            "suite-fix1browser-animation-0" &&
            getComputedStyle(node).animationTimingFunction === "linear",
          "keyword name disambiguated",
        );
      } finally {
        row.remove();
      }
    }
  });
}

export function checkCustomPropertyCascade(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix1_custom_literals_descriptor_vars_fallbacks_and_cascade", () => {
    const row = sample(
      '@keyframes pulse{to{opacity:1}}@keyframes fade{to{opacity:1}}@font-face{font-family:TestFamily;src:local("Arial")}.probe{--label:"pulse";--font:TestFamily;--whole:fade 1s linear;--opaque:?? pulse {x:TestFamily} url(#sprite);animation-name:var(--label);animation-duration:1s;font-family:var(--font,TestFamily)}.probe::before{content:var(--label,"pulse")}.alternate{--label:"fade"}',
      '<div class="probe">default</div><div class="probe alternate">cascade</div>',
      true,
    );
    try {
      const [first, second] =
        row.element.querySelectorAll<HTMLElement>(".probe");
      assert(
        getComputedStyle(first, "::before").content === '"pulse"' &&
          getComputedStyle(second, "::before").content === '"fade"',
        "same variable content preserved through cascade",
      );
      assert(
        getComputedStyle(first).animationName ===
          "suite-fix1browser-animation-0" &&
          getComputedStyle(second).animationName ===
            "suite-fix1browser-animation-1",
        "descriptor mirrors follow cascade",
      );
      assert(
        getComputedStyle(first).fontFamily === "suite-fix1browser-font-0",
        "font variable resolved",
      );
      assert(
        getComputedStyle(first)
          .getPropertyValue("--opaque")
          .includes("pulse {x:TestFamily}"),
        "opaque original preserved",
      );
      row.inline(first, {
        animationName: "var(--missing,var(--label,pulse))",
        fontFamily: "var(--missing,TestFamily)",
      });
      assert(
        getComputedStyle(first).animationName ===
          "suite-fix1browser-animation-0" &&
          getComputedStyle(first).fontFamily === "suite-fix1browser-font-0",
        "stylesheet variables consumed by inline with nested fallback",
      );
      row.inline(first, { animation: "var(--whole,fade 1s linear)" });
      assert(
        getComputedStyle(first).animationName ===
          "suite-fix1browser-animation-1" &&
          getComputedStyle(first).animationTimingFunction === "linear",
        "whole shorthand variable",
      );
    } finally {
      row.remove();
    }
  });
}

export function checkCaseSensitiveStyleIdentities(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix1_uppercase_keywords_and_case_sensitive_identities", () => {
    const multi = sample(
      '@font-face{font-family:My Font;src:local("Arial")}.probe{--family:My Font;font-family:var(--family),My Font}',
    );
    try {
      const node = multi.element.querySelector<HTMLElement>(".probe")!;
      assert(
        getComputedStyle(node).fontFamily ===
          "suite-fix1browser-font-0, suite-fix1browser-font-0",
        "multiword fallback family consumed as one sequence",
      );
      multi.inline(node, { fontFamily: "var(--family),My Font" });
      assert(
        getComputedStyle(node).fontFamily ===
          "suite-fix1browser-font-0, suite-fix1browser-font-0",
        "inline multiword family token removal",
      );
    } finally {
      multi.remove();
    }
    const row = sample(
      '@KEYFRAMES Pulse{TO{opacity:1}}@FONT-FACE{FONT-FAMILY:TestFamily;SRC:local("Arial")}@LAYER Layer{.probe{ANIMATION-NAME:Pulse;ANIMATION-DURATION:1s;FONT-FAMILY:testfamily}}',
      undefined,
      true,
    );
    try {
      const node = row.element.querySelector<HTMLElement>(".probe")!;
      assert(
        getComputedStyle(node).animationName ===
          "suite-fix1browser-animation-0" &&
          getComputedStyle(node).fontFamily === "suite-fix1browser-font-0",
        "uppercase descriptor keywords",
      );
      row.inline(node, { animationName: "pulse" });
      assert(
        getComputedStyle(node).animationName === "pulse",
        "frame identities stay case-sensitive",
      );
      row.inline(node, {
        "ANIMATION-NAME": "Pulse",
        "FONT-FAMILY": "TESTFAMILY",
      });
      assert(
        getComputedStyle(node).animationName ===
          "suite-fix1browser-animation-0" &&
          getComputedStyle(node).fontFamily === "suite-fix1browser-font-0",
        "uppercase inline property classification",
      );
    } finally {
      row.remove();
    }
  });
}

export function checkRegisteredMirrorDefaults(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix1_registered_mirror_defaults_and_noninheritance", () => {
    const row = sample(
      '@PROPERTY --Motion{SYNTAX:"<custom-ident>";INHERITS:false;INITIAL-VALUE:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.parent{--Motion:pulse}.probe{animation-name:var(--Motion);animation-duration:1s}',
      '<div class="parent"><div class="probe">registered default</div></div>',
      true,
    );
    try {
      const node = row.element.querySelector<HTMLElement>(".probe")!;
      assert(
        getComputedStyle(node).animationName ===
          "suite-fix1browser-animation-0",
        "inherits false keeps registered default rather than parent value",
      );
      row.inline(node, { animationName: "var(--Motion)" });
      assert(
        getComputedStyle(node).animationName ===
          "suite-fix1browser-animation-0",
        "inline retains registered default",
      );
      row.inline(node, { "--Motion": "pulse", animationName: "var(--Motion)" });
      assert(
        getComputedStyle(node).animationName ===
          "suite-fix1browser-animation-1",
        "local registered value and its mirrors",
      );
    } finally {
      row.remove();
    }
  });
}

export function checkActualAmbiguousConsumers(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix1_R4f_actual_ambiguous_consumers_only", () => {
    const definitions =
      "@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}";
    const row = sample(
      definitions + ".probe{--x:linear;animation:fade 1s var(--x)}",
    );
    try {
      const node = row.element.querySelector<HTMLElement>(".probe")!;
      assert(
        getComputedStyle(node).animationTimingFunction === "linear" &&
          getComputedStyle(node).animationName ===
            "suite-fix1browser-animation-1",
        "fixed name leaves var in timing role",
      );
    } finally {
      row.remove();
    }
    for (const expression of ["ease 1s var(--x)", "var(--x) 1s linear"]) {
      let failed = false;
      try {
        sample(definitions + `.probe{--x:linear;animation:${expression}}`);
      } catch (error) {
        failed = /fix1-browser.css:\d+:\d+:.*animation-name\/font-family/.test(
          String(error),
        );
      }
      assert(failed, "ambiguous consumer diagnostic");
    }
    const unused = sample(
      definitions +
        ".probe{--x:linear;--potential:var(--x) 1s linear;content:var(--potential)}",
    );
    unused.remove();
    const plain = sample(".probe{animation:ease 1s var(--x)}");
    plain.remove();
  });
}
