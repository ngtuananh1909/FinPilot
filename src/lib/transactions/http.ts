/** JSON response that is never cached. DTOs contain no bigint, so JSON serialisation cannot throw. */
export function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
