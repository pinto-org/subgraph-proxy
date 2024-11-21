FROM node:22 AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

FROM node:22-slim
WORKDIR /app
COPY --from=builder /usr/src/app .

USER node
EXPOSE 3001

CMD [ "npm", "start" ]
