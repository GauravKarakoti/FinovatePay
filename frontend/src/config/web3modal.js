import { createWeb3Modal } from '@web3modal/wagmi/react'
import { defaultWagmiConfig } from '@web3modal/wagmi/react/config'
import { polygonAmoy } from 'wagmi/chains'

const projectId = '25898a93205c4f1288e2df741bf24af1'

const metadata = {
  name: 'FinovatePay',
  description: 'FinovatePay dApp',
  url: 'https://localhost',
  icons: []
}

export const config = defaultWagmiConfig({
  chains: [polygonAmoy],
  projectId,
  metadata
})

createWeb3Modal({
  wagmiConfig: config,
  projectId,
  chains: [polygonAmoy]
})
