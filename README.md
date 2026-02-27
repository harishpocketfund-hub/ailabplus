# Company System

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. In Supabase SQL Editor, run `supabase/schema.sql`.

4. Fill `.env.local` with:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`

5. Start the app:

```bash
npm run dev
```

6. Optional connection check:

`GET http://localhost:3000/api/supabase/health`

## Supabase SQL Assistant Prompt

If you prefer Supabase AI SQL, use `supabase/setup-prompt.md`.
