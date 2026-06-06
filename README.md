# AI QA Copilot Backend

Express + TypeScript backend for generating real AI test plans with Groq.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Add your real `GROQ_API_KEY` in `backend/.env`.

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
```

Request body:

```json
{
  "requirement": "Add OTP login for existing users",
  "testType": "functional"
}
```

The response includes positive cases, negative cases, edge cases, test data, acceptance criteria, Playwright skeleton, and regression impact analysis.

## Frontend Integration

Set this in the frontend `.env`:

```text
VITE_API_BASE_URL=http://localhost:4000
```

The frontend will call the backend when this value is configured. If it is not configured, the frontend keeps using mock data.
