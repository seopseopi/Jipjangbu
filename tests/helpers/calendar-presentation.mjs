import { registerHooks } from "node:module";

// Match the application's bundler resolution while running the actual pure
// calendar module under Node's native TypeScript test runner.
const calendarModule = new URL("../../app/calendar-presentation.ts", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === calendarModule.href && specifier === "./work-property-summary") {
      return { url: new URL("../../app/work-property-summary.ts", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
export const { calendarWorkPresentation } = await import(calendarModule.href);
hook.deregister();
