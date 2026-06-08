import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  addHistoryReviewComment,
  approveHistory,
  getHistoryReviewComments,
  getReviewDetail,
  getReviewQueue,
  rejectHistory,
  requestHistoryChanges,
  submitHistoryForReview,
} from "./projectStore.js";

const router = Router();

const OptionalCommentSchema = z.object({ comment: z.string().trim().optional() });
const RequiredCommentSchema = z.object({ comment: z.string().trim().min(1) });

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.post("/review/submit/:historyId", asyncRoute(async (request, response) => {
  const { comment } = OptionalCommentSchema.parse(request.body);
  const history = await submitHistoryForReview(param(request.params.historyId), comment);
  if (!history) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(history);
}));

router.get("/review/queue", asyncRoute(async (_request, response) => {
  response.json(await getReviewQueue());
}));

router.get("/review/:historyId", asyncRoute(async (request, response) => {
  const detail = await getReviewDetail(param(request.params.historyId));
  if (!detail) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(detail);
}));

router.post("/review/approve/:historyId", asyncRoute(async (request, response) => {
  const { comment } = OptionalCommentSchema.parse(request.body);
  const history = await approveHistory(param(request.params.historyId), comment);
  if (!history) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(history);
}));

router.post("/review/request-changes/:historyId", asyncRoute(async (request, response) => {
  const { comment } = RequiredCommentSchema.parse(request.body);
  const history = await requestHistoryChanges(param(request.params.historyId), comment);
  if (!history) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(history);
}));

router.post("/review/reject/:historyId", asyncRoute(async (request, response) => {
  const { comment } = RequiredCommentSchema.parse(request.body);
  const history = await rejectHistory(param(request.params.historyId), comment);
  if (!history) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(history);
}));

router.post("/review/comment/:historyId", asyncRoute(async (request, response) => {
  const { comment } = RequiredCommentSchema.parse(request.body);
  const reviewComment = await addHistoryReviewComment(param(request.params.historyId), comment);
  if (!reviewComment) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.status(201).json(reviewComment);
}));

router.get("/review/comments/:historyId", asyncRoute(async (request, response) => {
  response.json(await getHistoryReviewComments(param(request.params.historyId)));
}));

export { router as reviewRouter };
