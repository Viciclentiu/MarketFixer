FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node server.js .

USER node
EXPOSE 8000

CMD ["node", "server.js"]
