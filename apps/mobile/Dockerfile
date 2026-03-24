FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

EXPOSE 8081

CMD ["npx", "expo", "start", "--web", "--port", "8081"]
