import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { generateAIChatResponse } from "./aiChat.js";
import {
  appendAIChatMessages,
  assertAIUsageQuota,
  deleteAIChat,
  getAIChat,
  getAIChatContext,
  listAIChats,
  saveChatResponseAsNewVersion,
} from "./projectStore.js";

const router = Router();

const MessageSchema = z.object({
  chatId: z.string().optional(),
  projectId: z.string().min(1),
  moduleId: z.string().min(1),
  requirementId: z.string().min(1),
  historyVersionId: z.string().optional(),
  userMessage: z.string().trim().min(1),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.post("/ai-chat/message", asyncRoute(async (request, response) => {
  const input = MessageSchema.parse(request.body);
  const context = await getAIChatContext(input);
  if (!context) {
    response.status(404).json({ message: "Selected project, module, or requirement was not found." });
    return;
  }

  await assertAIUsageQuota({ projectId: input.projectId, moduleId: input.moduleId, type: "chat" });
  const aiResponse = await generateAIChatResponse(context, input.userMessage, request.userId);
  const chat = await appendAIChatMessages({ ...input, aiResponse, userId: request.userId });
  response.status(input.chatId ? 200 : 201).json(chat);
}));

router.get("/ai-chat/history", asyncRoute(async (_request, response) => {
  response.json(await listAIChats());
}));

router.get("/ai-chat/:chatId", asyncRoute(async (request, response) => {
  const chat = await getAIChat(param(request.params.chatId));
  if (!chat) {
    response.status(404).json({ message: "Chat not found." });
    return;
  }
  response.json(chat);
}));

router.delete("/ai-chat/:chatId", asyncRoute(async (request, response) => {
  const deleted = await deleteAIChat(param(request.params.chatId));
  if (!deleted) {
    response.status(404).json({ message: "Chat not found." });
    return;
  }
  response.status(204).send();
}));

router.post("/ai-chat/:chatId/save-as-version", asyncRoute(async (request, response) => {
  const input = z.object({ historyVersionId: z.string().optional() }).parse(request.body);
  const history = await saveChatResponseAsNewVersion({
    chatId: param(request.params.chatId),
    historyVersionId: input.historyVersionId,
  });
  if (!history) {
    response.status(404).json({ message: "Chat or source history version was not found." });
    return;
  }
  response.status(201).json(history);
}));

export { router as aiChatRouter };
