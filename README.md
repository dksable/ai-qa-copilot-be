# AI QA Copilot Backend

Express + TypeScript backend for **AI QA Copilot**, an AI-powered Quality Engineering Platform. The backend supports authentication, MongoDB-backed persistence, AI test generation, project/workspace workflows, manual execution, analytics, AI providers, GitHub repository intelligence, GitHub Actions validation, AI failure analysis, auto-fix proposals, retry validation, validation history, and release readiness APIs.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Configure required environment variables in `.env`.

Common variables:

```text
PORT=4000
MONGODB_URI=<mongodb-uri>
MONGODB_DB_NAME=ai-qa-copilot
JWT_SECRET=<permanent-secret>
JWT_EXPIRES_IN=7d
GROQ_API_KEY=<optional-default-ai-key>
BACKEND_PUBLIC_URL=<render-or-public-backend-url>
```

## Run

```bash
npm run dev
```

Default API URL:

```text
http://localhost:4000
```

## Endpoints

```text
GET /health
POST /api/generate-testcases
POST /api/validation/:validationRunId/failure-analysis
POST /api/validation/:validationRunId/auto-fix
POST /api/validation/:validationRunId/retry
GET /api/validation/history
GET /api/release-readiness/summary
```

Request body:

```json
{
  "requirement": "Add OTP login for existing users",
  "testType": "functional"
}
```

The AI generation response includes positive cases, negative cases, edge cases, test data, acceptance criteria, Playwright skeleton, and regression impact analysis.

Validation intelligence APIs support AI failure analysis, reviewable auto-fix proposals, user-triggered retries, validation history, and release readiness summaries.

## Frontend Integration

Set this in the frontend `.env`:

```text
VITE_API_BASE_URL=http://localhost:4000
```

The frontend calls the backend when this value is configured.
