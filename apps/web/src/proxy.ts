import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/*
  In Clerk mode the Clerk middleware keeps the session cookie fresh so that
  useAuth().getToken() always has a token to send. In dev mode (no publishable
  key) requests pass straight through; sign-in state lives in the browser.
*/
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function passThrough() {
  return NextResponse.next();
}

export default clerkEnabled ? clerkMiddleware() : passThrough;

export const config = {
  matcher: ["/((?!_next|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?)$).*)"],
};
