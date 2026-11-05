// #2319 — Auth.js routes: /api/auth/signin/<provider>, /api/auth/callback/<provider>,
// /api/auth/session, /api/auth/providers, /api/auth/csrf, /api/auth/signout.
import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
