FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/addon/package.json packages/addon/package.json
RUN npm install

COPY . .
RUN npm run build --workspace @snoopy/backend

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/backend/package.json packages/backend/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/backend/dist packages/backend/dist

EXPOSE 8080
CMD ["node", "packages/backend/dist/index.js"]
