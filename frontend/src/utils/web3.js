import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { BrowserProvider, Contract } from 'ethers';

// Import contract ABIs and addresses
import EscrowContractArtifact from '../../../deployed/EscrowContract.json';
import InvoiceFactoryArtifact from '../../../deployed/InvoiceFactory.json';
import ProduceTrackingArtifact from '../../../deployed/ProduceTracking.json';
import FractionTokenArtifact from '../../../deployed/FractionToken.json';
import contractAddresses from '../../../deployed/contract-addresses.json';
import FinancingManagerArtifact from '../../../deployed/FinancingManager.json';
import ERC20Artifact from '../../../deployed/ERC20.json';

// Stablecoin addresses on Polygon Amoy
export const stablecoinAddresses = {
  USDC: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  EURC: '0x1aBaEA1f7C830bD89Acc67Ec4af516284b1BC33c',
  BRLC: '0x6DEf515A0419D4613c7A3950796339A4405d4191',
};

// Define Polygon Amoy Testnet as a custom chain for Reown AppKit
const polygonAmoy = {
  id: 80002,
  name: 'Polygon Amoy Testnet',
  system: 'evm',
  nativeCurrency: {
    decimals: 18,
    name: 'Matic',
    symbol: 'MATIC',
  },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL || 'https://rpc.ankr.com/polygon_amoy'],
    },
  },
  blockExplorers: {
    default: {
      name: 'OKLink',
      url: 'https://www.oklink.com/amoy',
    },
  },
  testnet: true,
};

// App Metadata
const metadata = {
  name: 'FinovatePay',
  description: 'B2B Payment Rail with Blockchain Settlement',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://finovatepay.com',
  icons: [typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : 'https://finovatepay.com/logo.png'],
};

// Create Reown AppKit instance
let modal;
if (typeof window !== 'undefined') {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  
  if (!projectId) {
    console.error('❌ WalletConnect Project ID is required!');
    console.error('Please add VITE_WALLETCONNECT_PROJECT_ID to your .env file');
    console.error('Get your Project ID from: https://cloud.walletconnect.com');
  } else {
    try {
      modal = createAppKit({
        adapters: [new EthersAdapter()],
        networks: [polygonAmoy],
        metadata: metadata,
        projectId: projectId,
        defaultNetwork: polygonAmoy,
        features: {
          analytics: true,
        },
        themeMode: 'light',
        themeVariables: {
          '--w3m-accent': '#2980B9',
        },
      });
    } catch (error) {
      console.error('Failed to initialize Reown AppKit:', error);
    }
  }
}

// Get Reown AppKit instance
export function getAppKit() {
  return modal;
}

// Check if wallet is connected
export function isWalletConnected() {
  if (!modal) return false;
  try {
    return modal.getAccount()?.isConnected || false;
  } catch (error) {
    return false;
  }
}

// Get connected wallet address
export function getConnectedAddress() {
  if (!modal) return null;
  try {
    return modal.getAccount()?.address || null;
  } catch (error) {
    return null;
  }
}

// Ensure user is on Amoy network
async function ensureAmoyNetwork(provider) {
  try {
    const network = await provider.getNetwork();
    
    // Compare chainId (ethers v6 returns BigInt)
    if (network.chainId !== 80002n) {
      // Request network switch
      if (modal) {
        await modal.switchNetwork(polygonAmoy);
      }
    }
  } catch (error) {
    console.error('Network switch error:', error);
    throw new Error('Please switch to Polygon Amoy Testnet');
  }
}

// Connect wallet and return provider, signer, and address
export async function connectWallet() {
  try {
    if (!modal) {
      throw new Error('Reown AppKit not initialized');
    }

    // Open modal if not connected
    let isConnected = false;
    try {
      // getAccount() might throw if no active chain is set initially
      isConnected = modal.getAccount()?.isConnected || false;
    } catch (e) {
      // silent fail, proceed to open modal
    }

    if (!isConnected) {
      await modal.open();
      
      // Wait for connection
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 60000); // 60 second timeout

        const checkConnection = setInterval(async () => {
          try {
            const account = modal.getAccount();
            if (account?.isConnected) {
              clearInterval(checkConnection);
              clearTimeout(timeout);
              
              try {
                const result = await getWalletInfo();
                resolve(result);
              } catch (error) {
                reject(error);
              }
            }
          } catch (e) {
            // Ignore errors while polling (e.g., initial state)
          }
        }, 500);
      });
    }

    return await getWalletInfo();
  } catch (error) {
    console.error('Wallet connection error:', error);
    
    if (error.code === 4001) {
      throw new Error('User rejected wallet connection');
    } else if (error.code === -32002) {
      throw new Error('Connection request already pending in wallet');
    }
    
    throw error;
  }
}

// Get wallet information (provider, signer, address)
async function getWalletInfo() {
  try {
    // Get wallet provider from modal
    const walletProvider = modal.getWalletProvider();
    
    if (!walletProvider) {
      throw new Error('No wallet provider found');
    }

    // Create ethers v6 BrowserProvider
    const provider = new BrowserProvider(walletProvider);
    
    // Ensure correct network
    await ensureAmoyNetwork(provider);
    
    // Get signer (async in ethers v6)
    const signer = await provider.getSigner();
    const address = await signer.getAddress();

    return { signer, address, provider };
  } catch (error) {
    console.error('Error getting wallet info:', error);
    throw error;
  }
}

// Disconnect wallet
export async function disconnectWallet() {
  try {
    if (modal) {
      // Reown AppKit disconnect method
      await modal.disconnect();
    }
  } catch (error) {
    console.error('Disconnect error:', error);
    // Even if disconnect fails, we can still clear local state
    // The modal will handle the actual wallet disconnection
  }
}

// Contract helper functions
export async function getEscrowContract() {
  const { signer } = await connectWallet();
  return new Contract(contractAddresses.EscrowContract, EscrowContractArtifact.abi, signer);
}

export async function getFinancingManagerContract() {
  const { signer } = await connectWallet();
  return new Contract(contractAddresses.FinancingManager, FinancingManagerArtifact.abi, signer);
}

export async function getInvoiceFactoryContract() {
  const { signer } = await connectWallet();
  return new Contract(contractAddresses.InvoiceFactory, InvoiceFactoryArtifact.abi, signer);
}

export async function getProduceTrackingContract() {
  const { signer } = await connectWallet();
  return new Contract(contractAddresses.ProduceTracking, ProduceTrackingArtifact.abi, signer);
}

export async function getFractionTokenContract() {
  const { signer } = await connectWallet();
  return new Contract(contractAddresses.FractionToken, FractionTokenArtifact.abi, signer);
}

export async function getErc20Contract(tokenAddress) {
  const { signer } = await connectWallet();
  return new Contract(tokenAddress, ERC20Artifact.abi, signer);
}

// Token approval functions
export async function approveFinancingManager() {
  const contract = await getFractionTokenContract();
  console.log("Got contract")
  const tx = await contract.setApprovalForAll(contractAddresses.FinancingManager, true);
  console.log("Tx recieved")
  return tx.wait();
}

export async function checkFinancingManagerApproval() {
  const { address } = await connectWallet();
  const contract = await getFractionTokenContract();
  return await contract.isApprovedForAll(address, contractAddresses.FinancingManager);
}

export async function approveStablecoin(stablecoinAddress, amount) {
  const { signer } = await connectWallet();
  const contract = new Contract(stablecoinAddress, ERC20Artifact.abi, signer);
  const tx = await contract.approve(contractAddresses.FinancingManager, amount);
  return tx.wait();
}

export async function checkStablecoinAllowance(stablecoinAddress) {
  const { address, signer } = await connectWallet();
  const contract = new Contract(stablecoinAddress, ERC20Artifact.abi, signer);
  return await contract.allowance(address, contractAddresses.FinancingManager);
}

// Transaction functions
export async function buyFractions(tokenId, amount) {
  const contract = await getFinancingManagerContract();
  const tx = await contract.buyFractions(tokenId, amount);
  return tx.wait();
}

export async function buyFractionsNative(tokenId, amount) {
  const contract = await getFinancingManagerContract();
  const tx = await contract.buyFractionsNative(tokenId, amount, { value: amount });
  return tx.wait();
}

// Export ERC20 ABI for compatibility
export const erc20ABI = ERC20Artifact.abi;

// Legacy compatibility function (deprecated but kept for backward compatibility)
export const getStablecoinContract = async (stablecoinAddress) => {
  return getErc20Contract(stablecoinAddress);
};
