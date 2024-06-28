# Use a newer official Node.js image that is compatible with Prisma >=16.13
FROM node:16

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Run Prisma migrations and then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]

# Expose the port your app runs on
EXPOSE 8080