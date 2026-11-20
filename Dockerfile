FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json server.js wrangler.jsonc ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node cloudflare ./cloudflare
COPY --chown=node:node public ./public
COPY --chown=node:node LICENSE README.md SECURITY.md compose.yaml .env.example .gitignore .dockerignore ./
COPY --chown=node:node Dockerfile ./Dockerfile
COPY --chown=node:node docs ./docs
COPY --chown=node:node test ./test
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
