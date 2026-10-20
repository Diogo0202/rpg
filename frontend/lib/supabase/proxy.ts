import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sessionAccessEvent } from "../server-access-audit";

export async function updateSession(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const recordAccess = (subject: unknown, outcome: "checked" | "unavailable") => {
    const event = sessionAccessEvent(request.nextUrl.pathname, request.method, subject, outcome, requestId);
    if (event) console.info(JSON.stringify(event));
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    recordAccess(null, "unavailable");
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  try {
    const { data, error } = await supabase.auth.getClaims();
    recordAccess(error ? null : data?.claims.sub, error ? "unavailable" : "checked");
  } catch (error) {
    recordAccess(null, "unavailable");
    throw error;
  }
  response.headers.set("X-Request-ID", requestId);
  return response;
}
