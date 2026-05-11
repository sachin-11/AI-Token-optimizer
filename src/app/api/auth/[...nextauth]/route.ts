/**
 * NextAuth v5 Route Handler
 * Handles all /api/auth/* requests (signin, signout, callback, session, csrf)
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
