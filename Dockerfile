# Use a newer official Node.js image that is compatible with Prisma >=16.13
FROM node:16

# Install netcat
RUN apt-get update && apt-get install -y netcat

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

# Copy the wait-for-db script and make it executable
COPY wait-for-db.sh /usr/src/app/wait-for-db.sh
RUN chmod +x /usr/src/app/wait-for-db.sh

# Update the CMD to use the wait-for-db script, which will then start the server
CMD ["/usr/src/app/wait-for-db.sh"]

# Expose the port your app runs on
EXPOSE 8080