import { createAuthClient } from "better-auth/react";

/** Browser auth client for the login form. No secrets; session cookies only. */
export const authClient = createAuthClient();
