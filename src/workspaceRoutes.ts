import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole, requireWorkspaceAccess } from "./permissionMiddleware.js";
import {
  acceptWorkspaceInvite,
  createWorkspace,
  createWorkspaceInvite,
  deactivateWorkspaceMember,
  deleteWorkspace,
  getWorkspace,
  getWorkspacePermissions,
  listWorkspaceInvites,
  listWorkspaceMembers,
  listWorkspaceRoles,
  listWorkspaces,
  removeWorkspaceMember,
  updateWorkspace,
  updateWorkspaceInviteStatus,
  updateWorkspaceMemberProjects,
  updateWorkspaceMemberRole,
  updateWorkspaceRolePermissions,
} from "./projectStore.js";

const router = Router();

const RoleSchema = z.enum(["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]);
const ProjectPermissionSchema = z.enum(["Full Access", "Edit Access", "Review Access", "View Only"]);
const AssignedProjectsSchema = z
  .array(z.object({ projectId: z.string().min(1), permission: ProjectPermissionSchema }))
  .default([]);
const canManageWorkspace = [requireAuth, requireRole(["Owner", "Admin"])];
const canManageOwnerOnly = [requireAuth, requireRole(["Owner"])];
const canAccessWorkspace = [requireAuth, requireWorkspaceAccess()];

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.post("/workspaces", asyncRoute(async (request, response) => {
  const input = z.object({
    workspaceName: z.string().trim().min(1),
    description: z.string().trim().default(""),
    logo: z.string().optional(),
  }).parse(request.body);
  response.status(201).json(await createWorkspace(input));
}));

router.get("/workspaces", asyncRoute(async (_request, response) => {
  response.json(await listWorkspaces());
}));

router.get("/workspaces/:id", canAccessWorkspace, asyncRoute(async (request, response) => {
  const workspace = await getWorkspace(param(request.params.id));
  if (!workspace) {
    response.status(404).json({ message: "Workspace not found." });
    return;
  }
  response.json(workspace);
}));

router.put("/workspaces/:id", canManageWorkspace, asyncRoute(async (request, response) => {
  const input = z.object({
    workspaceName: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    logo: z.string().optional(),
  }).parse(request.body);
  const workspace = await updateWorkspace(param(request.params.id), input);
  if (!workspace) {
    response.status(404).json({ message: "Workspace not found." });
    return;
  }
  response.json(workspace);
}));

router.delete("/workspaces/:id", canManageOwnerOnly, asyncRoute(async (request, response) => {
  const deleted = await deleteWorkspace(param(request.params.id));
  if (!deleted) {
    response.status(404).json({ message: "Workspace not found." });
    return;
  }
  response.status(204).send();
}));

router.patch("/workspaces/:id/archive", canManageWorkspace, asyncRoute(async (request, response) => {
  const workspace = await updateWorkspace(param(request.params.id), { status: "Archived" });
  if (!workspace) {
    response.status(404).json({ message: "Workspace not found." });
    return;
  }
  response.json(workspace);
}));

router.get("/workspaces/:id/members", canAccessWorkspace, asyncRoute(async (request, response) => {
  response.json(await listWorkspaceMembers(param(request.params.id)));
}));

router.patch("/workspaces/:id/members/:memberId/role", canManageWorkspace, asyncRoute(async (request, response) => {
  const { role } = z.object({ role: RoleSchema }).parse(request.body);
  const member = await updateWorkspaceMemberRole(param(request.params.id), param(request.params.memberId), role);
  if (!member) {
    response.status(404).json({ message: "Member not found." });
    return;
  }
  response.json(member);
}));

router.patch("/workspaces/:id/members/:memberId/projects", canManageWorkspace, asyncRoute(async (request, response) => {
  const { assignedProjects } = z.object({ assignedProjects: AssignedProjectsSchema }).parse(request.body);
  const member = await updateWorkspaceMemberProjects(
    param(request.params.id),
    param(request.params.memberId),
    assignedProjects,
  );
  if (!member) {
    response.status(404).json({ message: "Member not found." });
    return;
  }
  response.json(member);
}));

router.delete("/workspaces/:id/members/:memberId", canManageWorkspace, asyncRoute(async (request, response) => {
  const removed = await removeWorkspaceMember(param(request.params.id), param(request.params.memberId));
  if (!removed) {
    response.status(404).json({ message: "Member not found." });
    return;
  }
  response.status(204).send();
}));

router.patch("/workspaces/:id/members/:memberId/deactivate", canManageWorkspace, asyncRoute(async (request, response) => {
  const member = await deactivateWorkspaceMember(param(request.params.id), param(request.params.memberId));
  if (!member) {
    response.status(404).json({ message: "Member not found." });
    return;
  }
  response.json(member);
}));

router.post("/workspaces/:id/invites", canManageWorkspace, asyncRoute(async (request, response) => {
  const input = z.object({
    email: z.string().email(),
    role: RoleSchema,
    assignedProjects: AssignedProjectsSchema,
    message: z.string().optional(),
  }).parse(request.body);
  const invite = await createWorkspaceInvite({ workspaceId: param(request.params.id), ...input });
  if (!invite) {
    response.status(404).json({ message: "Workspace not found." });
    return;
  }
  response.status(201).json(invite);
}));

router.get("/workspaces/:id/invites", canManageWorkspace, asyncRoute(async (request, response) => {
  response.json(await listWorkspaceInvites(param(request.params.id)));
}));

router.post("/workspaces/invites/accept", asyncRoute(async (request, response) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(request.body);
  const member = await acceptWorkspaceInvite(token);
  if (!member) {
    response.status(404).json({ message: "Invite not found." });
    return;
  }
  response.json(member);
}));

router.patch("/workspaces/:id/invites/:inviteId/revoke", canManageWorkspace, asyncRoute(async (request, response) => {
  const invite = await updateWorkspaceInviteStatus(param(request.params.id), param(request.params.inviteId), "Revoked");
  if (!invite) {
    response.status(404).json({ message: "Invite not found." });
    return;
  }
  response.json(invite);
}));

router.post("/workspaces/:id/invites/:inviteId/resend", canManageWorkspace, asyncRoute(async (request, response) => {
  const invite = await updateWorkspaceInviteStatus(param(request.params.id), param(request.params.inviteId), "Pending");
  if (!invite) {
    response.status(404).json({ message: "Invite not found." });
    return;
  }
  response.json(invite);
}));

router.get("/workspaces/:id/permissions/me", canAccessWorkspace, asyncRoute(async (request, response) => {
  response.json(await getWorkspacePermissions(param(request.params.id)));
}));

router.get("/workspaces/:id/roles", canAccessWorkspace, asyncRoute(async (request, response) => {
  response.json(await listWorkspaceRoles(param(request.params.id)));
}));

router.patch("/workspaces/:id/roles/:roleId", canManageWorkspace, asyncRoute(async (request, response) => {
  const input = z.object({ role: RoleSchema, permissions: z.array(z.string()) }).parse(request.body);
  response.json(await updateWorkspaceRolePermissions(param(request.params.id), input.role, input.permissions));
}));

export { router as workspaceRouter };
