# ─── ENDLESS — Dockerfile ────────────────────────────────────────────────────
# Multi-stage: build frontend with Node, serve with Python Flask

# Stage 1: Build frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production server
FROM python:3.12-slim
WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY app.py .

# Copy built frontend from stage 1
COPY --from=frontend /app/dist ./dist

# Runtime config
ENV FLASK_ENV=production
ENV OPENAI_API_KEY=""

EXPOSE 5000

CMD ["python3", "app.py"]
