#!/bin/bash

# Configuration
max_attempts=10
attempt_delay=10 # seconds

# Function to check database connection
check_db() {
  # mysqladmin ping -h "db" -u "root" --password="rootpassword" -P 3306 &> /dev/null
  nc -z db 3306
}

# Attempt to connect to the database with retries
attempt=1
while ! check_db; do
  if [ $attempt -le $max_attempts ]; then
    echo "Waiting for database to be ready (attempt: $attempt)..."
    sleep $attempt_delay
    ((attempt++))
  else
    echo "Failed to connect to database after $max_attempts attempts."
    exit 1
  fi
done

echo "Database is ready."
# Start the Node application
exec npm start