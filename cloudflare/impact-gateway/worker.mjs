const PREFIX = "/english";
const UPSTREAM = "https://english-engine.a0527698420.workers.dev";
export function rewriteText(text) {
  return text.replaceAll(UPSTREAM, PREFIX)
    .replace(/(["'`])\/(?!\/|english(?:\/|["'`]))/g, "$1" + PREFIX + "/")
    .replace(/url\(\s*\/(?!\/|english\/)/g, "url(" + PREFIX + "/");
}
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname !== PREFIX && !incoming.pathname.startsWith(PREFIX + "/")) {
      return new Response("Not found", {status: 404});
    }
    if (incoming.pathname === PREFIX || incoming.pathname === PREFIX + "/") {
      incoming.pathname = PREFIX + "/dashboard";
      return Response.redirect(incoming.toString(), 302);
    }
    const target = new URL(incoming.pathname.slice(PREFIX.length) + incoming.search, UPSTREAM);
    const forwarded = new Request(target, request);
    const response = await env.ENGINE.fetch(forwarded);
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    const location = headers.get("Location");
    if (location) {
      const redirect = new URL(location, target);
      if (redirect.origin === target.origin) {
        headers.set("Location", PREFIX + redirect.pathname + redirect.search + redirect.hash);
      }
    }
    const type = headers.get("Content-Type") || "";
    headers.set("Cache-Control", "no-store");
    if (/text\/html|(?:application|text)\/javascript|text\/css/.test(type) && request.method !== "HEAD") {
      headers.delete("Content-Length");
      headers.delete("Content-Encoding");
      headers.delete("ETag");
      return new Response(rewriteText(await response.text()), {status: response.status, statusText: response.statusText, headers});
    }
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
  }
};