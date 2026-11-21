import { prepareSuiteInlineStyle } from "../customization/css";

import type { CssFixtureContext } from "./suite-compiler-support";

export function checkLiteralRegistrationInheritance(
  context: CssFixtureContext,
) {
  const { assert, sample, check } = context;
  check(
    "fix2_N1_registered_literal_validation_defaults_and_inheritance",
    () => {
      for (const target of [false, true]) {
        const row = sample(
          '@property --Motion{syntax:"pulse | still";inherits:false;initial-value:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.parent{--Motion:pulse}.local{--Motion:pulse}.invalid{--Motion:unknown}.probe{animation-name:var(--Motion);animation-duration:1s}',
          '<div class="probe default"></div><div class="parent"><div class="probe nested"></div></div><div class="probe local"></div><div class="probe invalid"></div>',
          target,
        );
        try {
          const nodes = Array.from(
            row.element.querySelectorAll<HTMLElement>(".probe"),
          );
          const verify = () => {
            for (const [index, node] of nodes.entries()) {
              const name = index === 2 ? "pulse" : "still";
              assert(
                getComputedStyle(node).animationName ===
                  `suite-fix1browser-animation-${index === 2 ? 1 : 0}`,
                `registered literal ${node.className}`,
              );
              assert(
                getComputedStyle(node)
                  .getPropertyValue("--suite-fix1browser-property-0")
                  .trim() === name,
                `original validation ${node.className}`,
              );
            }
          };
          verify();
          for (const node of nodes)
            row.inline(node, { animationName: "var(--Motion)" });
          verify();
          row.inline(nodes[2], {
            "--Motion": "pulse",
            animationName: "var(--Motion)",
          });
          row.inline(nodes[3], {
            "--Motion": "invalid",
            animationName: "var(--Motion)",
          });
          verify();
        } finally {
          row.remove();
        }
      }
    },
  );
}

export function checkAnimationVariablePositions(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix2_N2_leading_middle_and_trailing_animation_variable", () => {
    const definitions =
      "@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}";
    for (const target of [false, true])
      for (const value of [
        "var(--timing) 1s fade",
        "1s var(--timing) fade",
        "fade 1s var(--timing)",
      ]) {
        const row = sample(
          definitions + `.probe{--timing:linear;animation:${value}}`,
          undefined,
          target,
        );
        try {
          const node = row.element.querySelector<HTMLElement>(".probe")!;
          const verify = () =>
            assert(
              getComputedStyle(node).animationName ===
                "suite-fix1browser-animation-1" &&
                getComputedStyle(node).animationTimingFunction === "linear",
              `fixed name in ${value}`,
            );
          verify();
          row.inline(node, { "--timing": "linear", animation: value });
          verify();
        } finally {
          row.remove();
        }
      }
  });
}

export function checkEscapedCustomProperties(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix2_N3_escaped_custom_declaration_reference_and_inline", () => {
    for (const target of [false, true]) {
      const row = sample(
        String.raw`.probe{--label\ x:"pulse";--Label\ x:"upper"}.probe::before{content:var(--label\ x)}.probe::after{content:var(--Label\ x)}`,
        undefined,
        target,
      );
      try {
        const node = row.element.querySelector<HTMLElement>(".probe")!;
        assert(
          getComputedStyle(node, "::before").content === '"pulse"',
          "escaped stylesheet reference",
        );
        assert(
          getComputedStyle(node, "::after").content === '"upper"',
          "escaped names remain case-sensitive",
        );
        row.inline(node, { content: String.raw`var(--label\ x)` });
        assert(
          getComputedStyle(node).content === '"pulse"',
          "stylesheet variable consumed by inline",
        );
        row.inline(node, {
          "--label x": '"local"',
          content: String.raw`var(--label\ x)`,
        });
        assert(
          getComputedStyle(node).content === '"local"',
          "escaped inline declaration and reference",
        );
        assert(
          getComputedStyle(node, "::after").content === '"upper"',
          "inline does not alias case-distinct name",
        );
        row.inline(
          node,
          prepareSuiteInlineStyle(
            String.raw`--slash\\x:"slash";content:var(--slash\\x)`,
            {
              sourcePath: "inline.html",
              resolveAsset: (ref) => ref,
            },
          ),
        );
        assert(
          getComputedStyle(node).content === '"slash"',
          "HTML style record keeps a literal backslash identity through inline rewriting",
        );
      } finally {
        row.remove();
      }
      const owned = sample(
        String.raw`@property --Frame\ x{syntax:"pulse | still";inherits:false;initial-value:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.probe{--Frame\ x:pulse;animation-name:var(--Frame\ x)}`,
        undefined,
        target,
      );
      try {
        const node = owned.element.querySelector<HTMLElement>(".probe")!;
        assert(
          getComputedStyle(node).animationName ===
            "suite-fix1browser-animation-1",
          "escaped registered identity and mirror",
        );
        owned.inline(node, {
          "--Frame x": "still",
          animationName: String.raw`var(--Frame\ x)`,
        });
        assert(
          getComputedStyle(node).animationName ===
            "suite-fix1browser-animation-0",
          "escaped registered inline identity",
        );
      } finally {
        owned.remove();
      }
    }
  });
}

export function checkRegistrationRepetition(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check("fix2_R4g_registered_repetition_semantic_boundary", () => {
    for (const name of ["pulse", "linear"]) {
      const definitions = `@property --Motion{syntax:"${name}+";inherits:false;initial-value:${name}}@keyframes ${name}{to{opacity:1}}`;
      for (const target of [false, true]) {
        let failed = false;
        try {
          sample(
            definitions +
              `.probe{--Motion:${name} ${name};animation:var(--Motion)}`,
            undefined,
            target,
          );
        } catch (error) {
          failed =
            /fix1-browser.css:\d+:\d+:.*Cannot preserve @property.*unregistered variable/.test(
              String(error),
            );
        }
        assert(
          failed,
          "registration validation mismatch gets a consumer diagnostic",
        );
        const unused = sample(
          definitions +
            `.probe{--Motion:${name} ${name};content:var(--Motion)}`,
          undefined,
          target,
        );
        try {
          failed = false;
          try {
            unused.rewrite.inline({ animation: "var(--Motion)" });
          } catch (error) {
            failed = /<inline-style>:1:1:.*Cannot preserve @property/.test(
              String(error),
            );
          }
          assert(failed, "inline actual consumer diagnosed");
        } finally {
          unused.remove();
        }
        const safe = sample(
          definitions + `.probe{--Motion:${name};animation:var(--Motion)}`,
          undefined,
          target,
        );
        try {
          const node = safe.element.querySelector<HTMLElement>(".probe")!;
          assert(
            getComputedStyle(node).animationName ===
              (name === "pulse" ? "suite-fix1browser-animation-0" : "none"),
            "safe repeated syntax remains supported",
          );
        } finally {
          safe.remove();
        }
        const list = sample(
          definitions.replace(`${name}+`, `${name}#`) +
            `.probe{--Motion:${name},${name};animation-name:var(--Motion)}`,
          undefined,
          target,
        );
        try {
          const node = list.element.querySelector<HTMLElement>(".probe")!;
          assert(
            getComputedStyle(node).animationName ===
              "suite-fix1browser-animation-0, suite-fix1browser-animation-0",
            "safe list registration remains supported",
          );
        } finally {
          list.remove();
        }
      }
    }
    const plain = sample(
      '@property --Motion{syntax:"pulse+";inherits:false;initial-value:pulse}.probe{--Motion:pulse pulse;animation:var(--Motion)}',
    );
    plain.remove();
  });
}

export function checkTypedRegistrationDefaults(context: CssFixtureContext) {
  const { assert, sample, check } = context;
  check(
    "fix3_N4_unchanged_typed_default_values_and_literal_alternative",
    () => {
      for (const target of [false, true]) {
        const row = sample(
          '@property --Motion{syntax:"pulse | <number>";inherits:false;initial-value:1}@keyframes pulse{to{opacity:1}}.parent{--Motion:pulse}.literal{--Motion:pulse}.numeric{--Motion:3}.invalid{--Motion:unknown}.probe{animation:var(--Motion)}',
          '<div class="probe default"></div><div class="parent"><div class="probe nested"></div></div><div class="probe literal"></div><div class="probe numeric"></div><div class="probe invalid"></div>',
          target,
        );
        try {
          const nodes = Array.from(
            row.element.querySelectorAll<HTMLElement>(".probe"),
          );
          const verify = (number = "3") => {
            for (const [index, node] of nodes.entries()) {
              const computed = getComputedStyle(node);
              assert(
                computed.animationName ===
                  (index === 2 ? "suite-fix1browser-animation-0" : "none"),
                `typed alternative name ${node.className}`,
              );
              assert(
                computed.animationIterationCount ===
                  (index === 3 ? number : "1"),
                `typed alternative iteration ${node.className}`,
              );
              assert(
                computed
                  .getPropertyValue("--suite-fix1browser-property-0")
                  .trim() ===
                  (index === 2 ? "pulse" : index === 3 ? number : "1"),
                `original registered value ${node.className}`,
              );
            }
          };
          verify();
          for (const node of nodes)
            row.inline(node, { animation: "var(--Motion)" });
          verify();
          row.inline(nodes[2], {
            "--Motion": "pulse",
            animation: "var(--Motion)",
          });
          row.inline(nodes[3], { "--Motion": 5, animation: "var(--Motion)" });
          row.inline(nodes[4], {
            "--Motion": "invalid",
            animation: "var(--Motion)",
          });
          verify("5");
        } finally {
          row.remove();
        }
      }
    },
  );
}
