import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { signAccessToken } from "./authToken.js";
import { requireAuth } from "./permissionMiddleware.js";
import {
  changeUserPassword,
  createPasswordReset,
  getAuthContext,
  googleLoginUser,
  loginUser,
  resetUserPassword,
  signupUser,
  updateUserProfile,
} from "./projectStore.js";

const router = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();

const strongPassword = z
  .string()
  .min(8)
  .regex(/[0-9]/, "Password must contain a number.")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol.");

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

const rateLimitAuth: RequestHandler = (request, response, next) => {
  const key = `${request.ip}:${request.path}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  if (current.count >= 20) {
    response.status(429).json({ message: "Too many attempts. Please try again shortly." });
    return;
  }
  current.count += 1;
  next();
};

function authResponse(context: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>) {
  const token = signAccessToken(context.user.id);
  return { ...token, ...context };
}

router.post("/auth/signup", rateLimitAuth, asyncRoute(async (request, response) => {
  const input = z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    password: strongPassword,
    confirmPassword: z.string(),
    workspaceName: z.string().trim().optional(),
  }).refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  }).parse(request.body);
  const context = await signupUser(input);
  response.status(201).json(authResponse(context));
}));

router.post("/auth/login", rateLimitAuth, asyncRoute(async (request, response) => {
  const input = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  }).parse(request.body);
  const context = await loginUser(input.email, input.password);
  response.json(authResponse(context));
}));

router.post("/auth/google", rateLimitAuth, asyncRoute(async (request, response) => {
  const input = z.object({
    credential: z.string().optional(),
    googleId: z.string().optional(),
    email: z.string().trim().email(),
    fullName: z.string().trim().min(1),
    avatar: z.string().optional(),
  }).parse(request.body);
  const context = await googleLoginUser(input);
  response.json(authResponse(context));
}));

router.post("/auth/logout", requireAuth, (_request, response) => {
  response.status(204).send();
});

router.get("/auth/me", requireAuth, asyncRoute(async (request, response) => {
  const context = await getAuthContext(request.userId!);
  response.json(context);
}));

router.post("/auth/forgot-password", rateLimitAuth, asyncRoute(async (request, response) => {
  const { email } = z.object({ email: z.string().trim().email() }).parse(request.body);
  const reset = await createPasswordReset(email);
  response.json({
    message: "If an account exists, password reset instructions are available.",
    resetLink: reset?.resetLink,
    resetToken: reset?.resetToken,
  });
}));

router.post("/auth/reset-password", rateLimitAuth, asyncRoute(async (request, response) => {
  const input = z.object({
    token: z.string().min(1),
    password: strongPassword,
    confirmPassword: z.string(),
  }).refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  }).parse(request.body);
  await resetUserPassword(input.token, input.password);
  response.json({ message: "Password reset successfully." });
}));

router.patch("/auth/profile", requireAuth, asyncRoute(async (request, response) => {
  const input = z.object({
    fullName: z.string().trim().min(2).optional(),
    avatar: z.string().optional(),
  }).parse(request.body);
  response.json(await updateUserProfile(request.userId!, input));
}));

router.patch("/auth/change-password", requireAuth, asyncRoute(async (request, response) => {
  const input = z.object({
    currentPassword: z.string().min(1),
    newPassword: strongPassword,
  }).parse(request.body);
  await changeUserPassword(request.userId!, input.currentPassword, input.newPassword);
  response.json({ message: "Password changed successfully." });
}));

export { router as authRouter };
