# Build context is the repository root:  docker build -f gateway/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY gateway/package.json gateway/package-lock.json* ./gateway/
RUN cd gateway && npm install
COPY gateway ./gateway
RUN cd gateway && npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/gateway/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:4000/healthz || exit 1
CMD ["node", "--max-old-space-size=1024", "dist/server.js"]
