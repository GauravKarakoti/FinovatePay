@echo off
echo 🚀 Deploying FinovatePay Frontend to Vercel...

REM Navigate to frontend directory
cd frontend

REM Install dependencies if needed
echo 📦 Installing dependencies...
npm install

REM Build the project
echo 🔨 Building project...
npm run build

REM Deploy to Vercel (requires Vercel CLI)
echo 🌐 Deploying to Vercel...
npx vercel --prod

echo ✅ Deployment complete!
echo 🔗 Your app should be available at the URL provided by Vercel
pause