FROM node:22-alpine

# Chromium pentru Google Lighthouse (rulează headless în container)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto

ENV CHROME_PATH=/usr/bin/chromium-browser

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
