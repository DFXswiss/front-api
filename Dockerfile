FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
RUN npm install --omit=dev
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
