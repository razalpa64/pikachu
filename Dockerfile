FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig*.json ./
COPY server ./server
COPY src/games ./src/games
EXPOSE 8787
ENV RELAY_PORT=8787
CMD ["npm", "start"]
