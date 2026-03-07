#!/bin/bash

# Setup script to create .env files from examples
echo "Setting up environment files..."

# Copy root .env.example to .env if it doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✓ Created .env from .env.example"
    else
        echo "⚠ Warning: .env.example not found in root directory"
    fi
fi

# Copy backend .env.example to .env if it doesn't exist
if [ ! -f backend/.env ]; then
    if [ -f backend/.env.example ]; then
        cp backend/.env.example backend/.env
        echo "✓ Created backend/.env from backend/.env.example"
    else
        echo "⚠ Warning: backend/.env.example not found"
    fi
fi

# Copy frontend .env.example to .env if it doesn't exist
if [ ! -f frontend/.env ]; then
    if [ -f frontend/.env.example ]; then
        cp frontend/.env.example frontend/.env
        echo "✓ Created frontend/.env from frontend/.env.example"
    else
        echo "⚠ Warning: frontend/.env.example not found"
    fi
fi

echo ""
echo "Environment setup complete!"
echo "Please review and update the .env files with your specific configuration values."
echo ""
echo "To start the application:"
echo "  docker compose up --build"