# Auth refactor plan

## Move login handler

- Edit `src/auth/login.ts` to split the handler
- Create `src/auth/middleware.ts` with the extracted code

## Add tests

- Write `tests/auth/login.test.ts` covering the happy path

## Verify

- Run `pnpm test`
