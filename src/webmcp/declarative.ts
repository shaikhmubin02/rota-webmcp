import type { JsonSchema } from "./schema";

/**
 * The declarative half of WebMCP, implemented on top of the imperative half.
 *
 * The spec's declarative API lets a plain `<form>` become a tool by adding
 * attributes -- `toolname`, `tooldescription`, `toolparamdescription`, and the
 * `toolautosubmit` boolean -- with the browser synthesising the input schema
 * from the form's own controls. Chromium is trialling a loose version; the
 * synthesis algorithm itself is still marked TBD in the explainer.
 *
 * This module implements that synthesis in userland so the declarative path
 * works today, in any browser, and so Rota can demonstrate the attribute that
 * matters most for consent:
 *
 *   A form WITHOUT `toolautosubmit` may be filled by the agent but must be
 *   submitted by the human. The agent fills the publish form, the browser
 *   focuses the submit button, and the manager presses it.
 *
 * That is why Rota's publish action is a declarative form and not an imperative
 * tool. There is no code path -- none -- by which an agent publishes a rota.
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface DeclarativeToolInfo {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  autoSubmit: boolean;
  formId: string;
}

const registered = new Map<string, AbortController>();
let observer: MutationObserver | null = null;

function controlsOf(form: HTMLFormElement): Control[] {
  const seenRadioNames = new Set<string>();
  return [...form.elements].filter((el): el is Control => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
      return false;
    }
    if (!el.name || el.disabled) return false;
    if (el instanceof HTMLInputElement) {
      if (["submit", "reset", "button", "file", "image", "password"].includes(el.type)) return false;
      if (el.type === "radio") {
        if (seenRadioNames.has(el.name)) return false;
        seenRadioNames.add(el.name);
      }
    }
    return true;
  });
}

function describeControl(form: HTMLFormElement, control: Control): string {
  const explicit = control.getAttribute("toolparamdescription");
  if (explicit) return explicit;
  const labelled = control.getAttribute("aria-label");
  if (labelled) return labelled;
  if (control.id) {
    const label = form.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(control.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  if (control instanceof HTMLInputElement && control.placeholder) return control.placeholder;
  return control.name;
}

/** Deterministically compiles a form and its controls into a JSON Schema. */
export function synthesizeSchema(form: HTMLFormElement): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const control of controlsOf(form)) {
    const description = describeControl(form, control);
    let schema: JsonSchema = { type: "string", description };

    if (control instanceof HTMLSelectElement) {
      const options = [...control.options].map((o) => o.value).filter(Boolean);
      schema = { type: "string", description, ...(options.length ? { enum: options } : {}) };
    } else if (control instanceof HTMLInputElement) {
      switch (control.type) {
        case "checkbox":
          schema = { type: "boolean", description };
          break;
        case "number":
        case "range": {
          schema = {
            type: control.step && control.step !== "1" ? "number" : "integer",
            description,
            ...(control.min !== "" ? { minimum: Number(control.min) } : {}),
            ...(control.max !== "" ? { maximum: Number(control.max) } : {}),
          };
          break;
        }
        case "radio": {
          const group = [
            ...form.querySelectorAll<HTMLInputElement>(
              `input[type="radio"][name="${CSS.escape(control.name)}"]`,
            ),
          ].map((r) => r.value);
          schema = { type: "string", description, enum: group };
          break;
        }
        case "date":
          schema = { type: "string", description: `${description} (YYYY-MM-DD)` };
          break;
        case "time":
          schema = { type: "string", description: `${description} (HH:MM)` };
          break;
        default:
          schema = { type: "string", description };
      }
    }

    properties[control.name] = schema;
    if (control.required) required.push(control.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

/**
 * React (and every other framework with controlled inputs) ignores a plain
 * `element.value = x`. Setting through the prototype's setter and then firing
 * the events the framework listens for is the only reliable way for an agent to
 * fill a controlled form.
 */
function setControlValue(control: Control, value: unknown): string {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    const next = value === true || value === "true" || value === 1 || value === "on";
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    setter?.call(control, next);
    control.dispatchEvent(new Event("click", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return String(next);
  }

  if (control instanceof HTMLInputElement && control.type === "radio") {
    const target = control.form?.querySelector<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(control.name)}"][value="${CSS.escape(String(value))}"]`,
    );
    if (target) {
      target.click();
      return String(value);
    }
    return `(no radio option "${String(value)}")`;
  }

  const proto =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(control, String(value));
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return String(value);
}

function submitButtonOf(form: HTMLFormElement): HTMLElement | null {
  return (
    form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]') ??
    form.querySelector<HTMLElement>("button")
  );
}

async function registerForm(form: HTMLFormElement): Promise<void> {
  const name = form.getAttribute("toolname");
  if (!name || !document.modelContext) return;

  registered.get(name)?.abort();
  const controller = new AbortController();
  registered.set(name, controller);

  const autoSubmit = form.hasAttribute("toolautosubmit");
  const description =
    form.getAttribute("tooldescription") ??
    `Fills and submits the "${name}" form on this page.`;

  await document.modelContext.registerTool(
    {
      name,
      title: form.getAttribute("tooltitle") ?? name,
      description: autoSubmit
        ? description
        : `${description} You can fill this form but you cannot submit it: the form has no toolautosubmit attribute, so the browser will focus the submit button and the human must press it themselves.`,
      inputSchema: synthesizeSchema(form) as object,
      annotations: { readOnlyHint: false },
      async execute(args: Record<string, unknown>) {
        const filled: string[] = [];
        const skipped: string[] = [];
        for (const control of controlsOf(form)) {
          if (!(control.name in args) || args[control.name] === undefined) {
            skipped.push(control.name);
            continue;
          }
          filled.push(`${control.name} = ${setControlValue(control, args[control.name])}`);
        }

        if (autoSubmit) {
          form.requestSubmit();
          return {
            content: [
              {
                type: "text",
                text: `Filled and submitted "${name}". Set: ${filled.join("; ") || "nothing"}.`,
              },
            ],
          };
        }

        form.setAttribute("data-agent-filled", "true");
        // Tell the app the form was filled *before* trying to focus, so it can
        // reveal the form if it lives behind a tab. Focusing a hidden element
        // is a no-op, so wait for the app to paint first.
        window.dispatchEvent(new CustomEvent("rota:form-filled", { detail: { name } }));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);

        const button = submitButtonOf(form);
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        button?.focus();

        return {
          content: [
            {
              type: "text",
              text: [
                `Filled the "${name}" form: ${filled.join("; ") || "nothing"}.`,
                skipped.length ? `Left blank: ${skipped.join(", ")}.` : "",
                "I have NOT submitted it. This form has no toolautosubmit attribute, so submitting is the human's decision. The submit button is now focused on their screen - tell them what you filled in and ask them to press it.",
              ]
                .filter(Boolean)
                .join(" "),
            },
          ],
          structuredContent: { awaitingHuman: true, filled, skipped },
        };
      },
    } as never,
    { signal: controller.signal },
  );
}

/** Registers every `[toolname]` form and keeps up with DOM changes. */
export function startDeclarativeTools(): () => void {
  const scan = () => {
    for (const form of document.querySelectorAll<HTMLFormElement>("form[toolname]")) {
      void registerForm(form);
    }
  };

  scan();
  observer = new MutationObserver((records) => {
    const relevant = records.some(
      (r) =>
        r.type === "attributes" ||
        [...r.addedNodes, ...r.removedNodes].some(
          (n) => n instanceof HTMLElement && (n.matches?.("form[toolname]") || n.querySelector?.("form[toolname]")),
        ),
    );
    if (relevant) scan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["toolname", "tooldescription", "toolautosubmit", "toolparamdescription"],
  });

  return () => {
    observer?.disconnect();
    observer = null;
    for (const controller of registered.values()) controller.abort();
    registered.clear();
  };
}

/** Describes the declarative tools currently synthesised, for the inspector. */
export function declarativeToolInfo(): DeclarativeToolInfo[] {
  return [...document.querySelectorAll<HTMLFormElement>("form[toolname]")].map((form) => ({
    name: form.getAttribute("toolname")!,
    description: form.getAttribute("tooldescription") ?? "",
    inputSchema: synthesizeSchema(form),
    autoSubmit: form.hasAttribute("toolautosubmit"),
    formId: form.id,
  }));
}
