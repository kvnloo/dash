import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const SHA = /^[a-f0-9]{40}$/;

/** Only an operator-staged artifact and a preset device can reach the O15 installer. */
export function createAndroidUpdateHandler(directory: string | undefined, serial: string | undefined) {
  let installing = false;
  let installed: string | undefined;
  return async (request: Request, authorized: boolean): Promise<Response> => {
    if (!authorized) return new Response(null, { status: 401 });
    if (!directory || !isAbsolute(directory) || !serial || !/^[\w.:[\]-]+$/.test(serial)) return new Response(null, { status: 404 });
    if (request.method !== "GET" && request.method !== "POST") return new Response(null, { status: 405 });
    const url = new URL(request.url);
    let apk: string;
    let sha: string, version: number;
    try {
      const release = await realpath(directory);
      apk = join(release, "dash-native-arm64.apk");
      sha = (await readFile(join(release, "source-revision.txt"), "utf8")).trim();
      version = Number((await readFile(join(release, "version-code.txt"), "utf8")).trim());
      if (!SHA.test(sha) || !Number.isSafeInteger(version) || version <= 0 || !(await stat(apk)).isFile()) throw new Error();
    } catch { return new Response(null, { status: 404 }); }
    if (request.method === "GET") {
      return installed === sha ? new Response(null, { status: 204 }) : Response.json({ sha, version }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.searchParams.get("sha") !== sha) return new Response("Update changed. Check again.", { status: 409 });
    if (installed === sha) return new Response(null, { status: 204 });
    if (installing) return new Response("An install is already running.", { status: 409 });
    installing = true;
    try {
      const script = join(import.meta.dir, "../../scripts/phone-install.sh");
      const child = Bun.spawn(["bash", script, "--serial", serial, "--apk", apk, "--sha", sha, "--local-receipt"], {
        stdout: "ignore", stderr: "inherit", signal: AbortSignal.timeout(180_000),
      });
      if (await child.exited !== 0) return new Response("Install refused or failed. Check the bridge log.", { status: 503 });
      installed = sha;
      return new Response(null, { status: 204 });
    } catch {
      return new Response("Install failed. Check the bridge log.", { status: 503 });
    } finally { installing = false; }
  };
}
