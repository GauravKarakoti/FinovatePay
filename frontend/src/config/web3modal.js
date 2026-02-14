import { createWeb3Modal } from '@web3modal/wagmi/react'
import { defaultWagmiConfig } from '@web3modal/wagmi/react/config'
import { polygonAmoy } from 'wagmi/chains'

// 1. Get projectId
// Using a placeholder - in production this should be in .env as VITE_PROJECT_ID
export const projectId = import.meta.env.VITE_PROJECT_ID || '3a8170812b534d0ff9d794f19a901d64'

// 2. Create wagmiConfig
const metadata = {
  name: 'TradeFin',
  description: 'Invoice Factoring Platform',
  url: 'https://tradefin.example.com',
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

// Define chains
const chains = [polygonAmoy]

export const config = defaultWagmiConfig({
  chains,
  projectId,
  metadata,
  enableWalletConnect: true,
  enableInjected: true,
  enableEIP6963: true,
  enableCoinbase: true,
})

// 3. Create modal
createWeb3Modal({
  wagmiConfig: config,
  projectId,
  enableAnalytics: true,
  themeMode: 'light'
})
