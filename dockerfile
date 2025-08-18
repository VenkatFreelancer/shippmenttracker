# Use the official Puppeteer base image
FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Switch to root for setup
USER root

# Copy package files
COPY package*.json ./

# Install dependencies using npm install (works without package-lock.json)
RUN npm install --production --no-audit --no-fund

# Copy app source
COPY . .

# Create app directory and set permissions
RUN mkdir -p /home/pptruser/app && \
    cp -r . /home/pptruser/app && \
    chown -R pptruser:pptruser /home/pptruser/app

# Switch to pptruser and set working directory
USER pptruser
WORKDIR /home/pptruser/app

# Expose port
EXPOSE 10000

# Start the app
CMD ["node", "index.js"]