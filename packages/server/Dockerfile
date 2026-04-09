FROM node:20-alpine

WORKDIR /app

# Copy root configs
COPY package.json package-lock.json tsconfig.base.json ./

# Copy server package.json to install dependencies via monorepo logic
COPY packages/server/package.json packages/server/

# Install all dependencies required by the workspace
RUN npm ci

# Copy the server source code
COPY packages/server packages/server

# Build the server
WORKDIR /app/packages/server
RUN npm run build

# Start the server
EXPOSE 1234
CMD ["npm", "run", "start"]
