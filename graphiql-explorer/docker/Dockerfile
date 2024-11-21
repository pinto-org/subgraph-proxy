FROM node:18 AS builder
WORKDIR /usr/src/app
COPY package*.json ./
#RUN npm install --omit=dev
RUN npm install

COPY . .
# Copy the .env config for build time
COPY ./docker/inbuilt/.env .env

RUN npm run build

FROM node:18-slim
WORKDIR /app
COPY --from=builder /usr/src/app/ .

EXPOSE 4000

# Define the command to run your app
CMD ["node", "server.js"]
