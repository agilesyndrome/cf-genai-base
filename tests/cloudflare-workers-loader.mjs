import { registerHooks } from "node:module";

const moduleSource = `
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: `data:text/javascript,${encodeURIComponent(moduleSource)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
