# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root configs
COPY package.json package-lock.json tsconfig.base.json ./

# Copy the web app package.json
COPY apps/web/package.json apps/web/

# Install workspace dependencies
RUN npm ci

# Copy the web application source code
COPY apps/web apps/web

# Build the frontend (Vite React app)
WORKDIR /app/apps/web
RUN npm run build

# Production Stage - Nginx to serve static files
FROM nginx:alpine
# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*
# Copy compiled artifacts from builder stage
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
