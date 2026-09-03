import "react";

/**
 * WebMCP's declarative API adds attributes to `<form>` and form-associated
 * elements. React passes unknown lowercase attributes straight through to the
 * DOM, so they work at runtime already -- this just teaches TypeScript about
 * them so JSX using them type-checks.
 *
 * See the declarative API explainer:
 * https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md
 */
declare module "react" {
  interface HTMLAttributes<T> {
    /** Names the tool synthesised from this form. */
    toolname?: string;
    /** Natural-language description of what submitting the form does. */
    tooldescription?: string;
    /** Human-readable title for the synthesised tool. */
    tooltitle?: string;
    /**
     * Present ⇒ the agent may submit the form itself. Absent ⇒ the agent may
     * only fill it, and the browser focuses the submit button for the human.
     * Use `toolautosubmit=""` for presence, since React stringifies booleans.
     */
    toolautosubmit?: "";
    /** Description of the schema property this control contributes. */
    toolparamdescription?: string;
  }
}
