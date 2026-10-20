const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-only session checks, never a client-supplied access event or final route status. */
export function sessionAccessEvent(pathname: string, method: string, subject: unknown, outcome: "checked" | "unavailable", requestId: string) {
  let area: string;
  if (/^\/app(?:\/|$)/.test(pathname)) area = "campaign_workspace";
  else if (/^\/login(?:\/|$)/.test(pathname)) area = "login";
  else if (/^\/auth(?:\/|$)/.test(pathname)) area = "authentication";
  else return null;

  return {
    event: "web_session_access",
    timestamp: new Date().toISOString(),
    request_id: UUID.test(requestId) ? requestId.toLowerCase() : null,
    area,
    method: ["GET", "POST", "HEAD"].includes(method) ? method : "OTHER",
    actor_id: typeof subject === "string" && UUID.test(subject) ? subject.toLowerCase() : null,
    outcome,
    phase: "session_check",
  };
}
