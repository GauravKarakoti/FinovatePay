import { Buffer } from 'buffer';
window.Buffer = Buffer;
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { StatsProvider } from './context/StatsContext'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './config/web3modal'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <StatsProvider>
          <App />
        </StatsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
