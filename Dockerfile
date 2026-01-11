FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm install

COPY server .

# Create uploads dir
RUN mkdir -p uploads

CMD ["sh", "-c", "node index.js & node worker.js && wait"]
