import type { RequestHandler } from "express";

import { verifyAccessToken } from "./authToken.js";
import { getAuthContext, getCurrentWorkspaceMember, permissionsForRole } from "./projectStore.js";
import type { ProjectPermissionLevel, WorkspaceRole } from "./projectTypes.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function workspaceIdFrom(request: Parameters<RequestHandler>[0], paramName = "id") {
  return firstParam(request.params[paramName]) || String(request.body?.workspaceId ?? "");
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const userId = token ? verifyAccessToken(token) : null;
  if (!userId || !(await getAuthContext(userId))) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }
  request.userId = userId;
  next();
};

export function requireWorkspaceAccess(paramName = "id"): RequestHandler {
  return async (request, response, next) => {
    const workspaceId = workspaceIdFrom(request, paramName);
    const member = workspaceId && request.userId ? await getCurrentWorkspaceMember(workspaceId, request.userId) : null;
    if (!member) {
      response.status(403).json({ message: "You do not have access to this workspace." });
      return;
    }
    next();
  };
}

export function requireRole(roles: WorkspaceRole[], paramName = "id"): RequestHandler {
  return async (request, response, next) => {
    const workspaceId = workspaceIdFrom(request, paramName);
    const member = workspaceId && request.userId ? await getCurrentWorkspaceMember(workspaceId, request.userId) : null;
    if (!member || !roles.includes(member.role)) {
      response.status(403).json({ message: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}

export function requirePermission(permission: string, paramName = "id"): RequestHandler {
  return async (request, response, next) => {
    const workspaceId = workspaceIdFrom(request, paramName);
    const member = workspaceId && request.userId ? await getCurrentWorkspaceMember(workspaceId, request.userId) : null;
    if (!member || !permissionsForRole(member.role).includes(permission)) {
      response.status(403).json({ message: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}

export function requireProjectAccess(
  allowed: ProjectPermissionLevel[],
  workspaceParamName = "id",
  projectParamName = "projectId",
): RequestHandler {
  return async (request, response, next) => {
    const workspaceId = workspaceIdFrom(request, workspaceParamName);
    const projectId = firstParam(request.params[projectParamName]) || String(request.body?.projectId ?? "");
    const member = workspaceId && request.userId ? await getCurrentWorkspaceMember(workspaceId, request.userId) : null;
    if (!member) {
      response.status(403).json({ message: "You do not have access to this workspace." });
      return;
    }
    if (member.role === "Owner" || member.role === "Admin" || member.assignedProjects.length === 0) {
      next();
      return;
    }
    const projectAccess = member.assignedProjects.find((assignment) => assignment.projectId === projectId);
    if (!projectAccess || !allowed.includes(projectAccess.permission)) {
      response.status(403).json({ message: "You do not have permission to access this project." });
      return;
    }
    next();
  };
}
