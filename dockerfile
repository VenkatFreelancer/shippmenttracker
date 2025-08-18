# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Install Chrome dependencies for Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Create symbolic link for chromium-browser
RUN ln -s /usr/bin/chromium /usr/bin/chromium-browser

# Verify Chrome installation
RUN chromium --version || chromium-browser --version

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies with better error handling
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy source code
COPY . .

# Change ownership to non-root user
RUN chown -R nextjs:nodejs /usr/src/app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 10000

# Set environment variables - use the correct path for Alpine
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node healthcheck.js || exit 1

# Start the application
CMD ["node", "index.js"]