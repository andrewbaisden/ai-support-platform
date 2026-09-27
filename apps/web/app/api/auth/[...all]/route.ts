import { getAuth } from "@ai-support-platform/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Resolved per request so importing this module never requires credentials
// at build time. getAuth() caches the instance after first construction.
function signUpBlocked(pathname: string) {
  return (
    process.env.AUTH_ALLOW_SIGNUP !== "true" && /\/sign-up\//.test(pathname)
  );
}

function disabled() {
  return Response.json({ error: { code: "SIGNUP_DISABLED" } }, { status: 404 });
}

export async function GET(request: Request) {
  if (signUpBlocked(new URL(request.url).pathname)) return disabled();
  const { GET } = toNextJsHandler(getAuth());
  return GET(request);
}

export async function POST(request: Request) {
  if (signUpBlocked(new URL(request.url).pathname)) return disabled();
  const { POST } = toNextJsHandler(getAuth());
  return POST(request);
}
