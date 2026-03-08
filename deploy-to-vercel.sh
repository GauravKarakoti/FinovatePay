#!/bin/bash

# Deploy FinovatePay Frontend to Vercel
echo "🚀 Deploying FinovatePay Frontend to Vercel..."

# Navigate to frontend directory
cd frontend

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building project..."
npm run build

# Deploy to Vercel (requires Vercel CLI)
echo "🌐 Deploying to Vercel..."
npx vercel --prod

echo "✅ Deployment complete!"
echo "🔗 Your app should be available at the URL provided by Vercel"