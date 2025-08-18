# Use official Puppeteer image which includes Chrome
FROM ghcr.io/puppeteer/puppeteer:22.0.0

# Switch to root to set up the app
USER root

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --omit=dev --no-audit --no-fund

# Copy app source code
COPY . .

# Create downloads directory and set permissions
RUN mkdir -p /usr/src/app/downloads && \
    chown -R pptruser:pptruser /usr/src/app

# Switch back to non-root user
USER pptruser

# Expose port
EXPOSE 10000

# Environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]