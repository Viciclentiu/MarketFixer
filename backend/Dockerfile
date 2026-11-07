FROM node:22-alpine

WORKDIR /app

# Instalează dependențele
COPY package*.json ./
RUN npm install --omit=dev

# Copiază codul sursă și interfața publică de test
COPY src ./src
COPY public ./public

# Directorul pentru baza de date SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/server.js"]
