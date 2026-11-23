// Every card kind kvnloo/ephemeral-ui exports, keyed the way its own pages key them. Bundled into the
// card host page (host-entry.js) and evaluated by build.mjs, so the vendored kind list is the kit's.
import { KINDS_A } from "@eui/kinds-a.js";
import { KINDS_B } from "@eui/kinds-b.js";
import { KINDS_C } from "@eui/kinds-c.js";
import { KINDS_3D } from "@eui/kinds-3d.js";
import { KINDS_E } from "@eui/kinds-e.js";
import { KINDS_P } from "@eui/kinds-p.js";
import { KINDS_F } from "@eui/kinds-f.js";
import { KINDS_T } from "@eui/kinds-t.js";
import { KINDS_H } from "@eui/kinds-h.js";
import { KINDS_K } from "@eui/kinds-k.js";
import { KINDS_INFRA } from "@eui/kinds-infra.js";
import { KINDS_I } from "@eui/kinds-i.js";
import { KINDS_OPS, OPS_APPS } from "@eui/kinds-ops.js";
import { KINDS_FLEET, FLEET_APPS } from "@eui/kinds-fleet.js";
import { KINDS_INTEL } from "@eui/kinds-intel.js";
import { INTEL_APPS } from "@eui/intel-suite.js";
import { KINDS_DOCK } from "@eui/kinds-dock.js";
import { KINDS_CUA } from "@eui/kinds-cua.js";
import { KINDS_GEV } from "@eui/kinds-gev.js";

/** Module groups; the kit's own fixture each group reads (fetched from data/, embedded by the host). */
export const GROUPS = {
  a: [KINDS_A], b: [KINDS_B], "3d": [KINDS_3D], c: [KINDS_C], e: [KINDS_E], p: [KINDS_P], f: [KINDS_F],
  k: [KINDS_K], h: [KINDS_H], infra: [KINDS_INFRA],
  t: [KINDS_T, "trace"], i: [KINDS_I, "intent"], ops: [KINDS_OPS, "ops"], fleet: [KINDS_FLEET], intel: [KINDS_INTEL],
  dock: [KINDS_DOCK], cua: [KINDS_CUA], gev: [KINDS_GEV],
};
/** main.js's KINDS order, then the standalone modules the site mounts on their own pages. */
export const KINDS = Object.assign({}, ...Object.values(GROUPS).map(([kinds]) => kinds));
/**
 * Kinds no catalog app lists draw with the kit's own default app (ops-section.js, fleet.html, intel.html).
 * The kit gives the three standalone modules none, so the host names the app the kit catalog mounts them with.
 */
export const DEFAULT_APPS = { ...OPS_APPS, ...FLEET_APPS, ...INTEL_APPS, "cua-action": "cua", "work-dock": "z0", "gev-contacts": "god-s-eye-view" };
/** Default apps missing from apps.json, drawn the way the kit's pages draw them: `{ id, name, hex: null }`. */
export const HOST_APP_NAMES = { glide: "Glide", k3s: "k3s", z0: "z0 work" };
