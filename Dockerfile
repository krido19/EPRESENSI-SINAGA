FROM node:20-slim

# Install system dependencies (Python for graphify, git, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Copy config if not present
RUN if [ ! -f config.json ]; then cp config.example.json config.json; fi

# Expose port (Hugging Face Spaces default port is 7860)
ENV PORT=7860
EXPOSE 7860

# Start server
CMD ["node", "server.js"]
