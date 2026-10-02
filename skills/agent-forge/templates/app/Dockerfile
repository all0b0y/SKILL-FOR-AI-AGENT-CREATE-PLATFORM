FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Route discovery imports the DB module; these non-secret build-only values never connect.
# Runtime credentials must still be supplied by the operator.
RUN DATABASE_URL=postgres://build.invalid/unused APPROVAL_SECRET=build-only-not-a-runtime-secret pnpm build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
