export async function onRequestGet(context) {
  const path = context.params.path;

  const object = await context.env.GAMES.get(path);

  if (!object) {
    return new Response("File not found", { status: 404 });
  }

  const headers = new Headers();

  if (object.httpMetadata?.contentType) {
    headers.set("Content-Type", object.httpMetadata.contentType);
  }

  if (object.httpMetadata?.contentEncoding) {
    headers.set("Content-Encoding", object.httpMetadata.contentEncoding);
  }

  return new Response(object.body, {
    status: 200,
    headers
  });
}