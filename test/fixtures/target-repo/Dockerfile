FROM node:14
WORKDIR /app
COPY package.json .
RUN npm install --no-audit
COPY . .
EXPOSE 3000
USER root
CMD ["node", "server.js"]
