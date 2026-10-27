import { loadRoles } from "./model-roles";
import { modelHealth } from "./model-health";
export function createModelsHttpHandler(options: { authorize: (request: Request) => Promise<boolean>; roles?: typeof loadRoles; health?: typeof modelHealth }) {
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/models") return null;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
    if (!await options.authorize(request)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    try {
      const roles = (options.roles ?? loadRoles)();
      return json(await Promise.all(roles.map(async row => ({ ...row, health: await (options.health ?? modelHealth)(row.model) }))));
    }
    catch { return json({ error: "Invalid model role configuration" }, 503); }
  };
}
