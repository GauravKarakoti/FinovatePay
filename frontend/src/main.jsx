import { Buffer } from 'buffer';
window.Buffer = Buffer;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiConfig } from 'wagmi';
import { config } from './config/web3modal';
import './index.css';
import App from './App.jsx';
import { StatsProvider } from './context/StatsContext';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiConfig config={config}>
      <StatsProvider>
        <App />
      </StatsProvider>
    </WagmiConfig>
  </StrictMode>
);