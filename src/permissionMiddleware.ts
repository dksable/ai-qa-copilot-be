import type { RequestHandler } from "express";

import { getCurrentWorkspaceMember, permissionsForRole } from "./projectStore.js";
import type { ProjectPermissionLevel, WorkspaceRole } from "./projectTypes.js";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function workspaceIdFrom(request: Parameters<RequestHandler>[0], paramName = "id") {
  return firstParam(request.params[paramName]) || String(request.body?.workspaceId ?? "");
}

export const requireAuth: RequestHandler = (_request, _response, next) => {
  next();
};

export function requireWorkspaceAccess(paramName = "id"): RequestHandler {
  return async (request, response, next) => {
    const workspaceId = workspaceIdFrom(request, paramName);
    const member = workspaceId ? await getCurrentWorkspaceMember(workspaceId) : null;
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
    const member = workspaceId ? await getCurrentWorkspaceMember(workspaceId) : null;
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
    const member = workspaceId ? await getCurrentWorkspaceMember(workspaceId) : null;
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
    const member = workspaceId ? await getCurrentWorkspaceMember(workspaceId) : null;
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
