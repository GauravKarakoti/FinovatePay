import { ethers } from 'ethers';
import Web3Modal from 'web3modal';
// Import contract ABIs and addresses
import EscrowContractArtifact from '../../../deployed/EscrowContract.json';
import InvoiceFactoryArtifact from '../../../deployed/InvoiceFactory.json'; 
import contractAddresses from '../../../deployed/contract-addresses.json';

let web3Modal;
let provider;

const providerOptions = {};

if (typeof window !== 'undefined') {
    web3Modal = new Web3Modal({
        network: "mumbai",
        cacheProvider: true,
        providerOptions
    });
}

export async function connectWallet() {
    provider = await web3Modal.connect();
    const web3Provider = new ethers.providers.Web3Provider(provider);
    const signer = web3Provider.getSigner();
    const address = await signer.getAddress();
    return { signer, address, provider: web3Provider };
}

// Function to get a read/write instance of the EscrowContract
export async function getEscrowContract() {
    const { signer } = await connectWallet();
    return new ethers.Contract(
        contractAddresses.EscrowContract,
        EscrowContractArtifact.abi,
        signer
    );
}

export async function getInvoiceFactoryContract() {
    const { signer } = await connectWallet();
    return new ethers.Contract(
        contractAddresses.InvoiceFactory, // Make sure this name matches your deployed JSON
        InvoiceFactoryArtifact.abi,
        signer
    );
}


// Mock ERC20 Token ABI (only need 'approve' function for this)
export const erc20ABI = [
    "function approve(address spender, uint256 amount) public returns (bool)"
];


export async function disconnectWallet() {
    if (web3Modal) {
        web3Modal.clearCachedProvider();
    }
    provider = null;
}