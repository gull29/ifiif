const VOTE_API_URL = "https://game-votes-api.thepizzaedition.workers.dev/vote";

export async function onRequest(context) {
  const sourceUrl = new URL(context.request.url);
  const targetUrl = new URL(VOTE_API_URL);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers();
  const contentType = context.request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const init = {
    method: context.request.method,
    headers,
  };

  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = await context.request.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}
