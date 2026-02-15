import { Buffer } from 'buffer';
window.Buffer = Buffer;
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { StatsProvider } from './context/StatsContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StatsProvider>
      <App />
    </StatsProvider>
  </StrictMode>,
)
