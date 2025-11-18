import { ethers } from 'ethers';
import Web3Modal from 'web3modal';
// Import contract ABIs and addresses
import EscrowContractArtifact from '../../../deployed/EscrowContract.json';
import InvoiceFactoryArtifact from '../../../deployed/InvoiceFactory.json'; 
import ProduceTrackingArtifact from '../../../deployed/ProduceTracking.json';
import FractionTokenArtifact from '../../../deployed/FractionToken.json';
import contractAddresses from '../../../deployed/contract-addresses.json';
import FinancingManagerArtifact from "../../../deployed/FinancingManager.json";
// You need a standard ERC20 ABI file. You can get this from OpenZeppelin.
// Place it in 'deployed/ERC20.json' or 'src/abis/ERC20.json'
import ERC20Artifact from "../../../deployed/ERC20.json";

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

export const stablecoinAddresses = {
    "USDC": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    "EURC": "0x1aBaEA1f7C830bD89Acc67Ec4af516284b1BC33c",
    "BRLC": "0x6DEf515A0419D4613c7A3950796339A4405d4191" // Example for Latam
};

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

export async function getFinancingManagerContract() {
    const { signer } = await connectWallet();
    return new ethers.Contract(
        contractAddresses.FinancingManager, // Ensure this exists in your contract-addresses.json
        FinancingManagerArtifact.abi,
        signer
    );
}

export const getStablecoinContract = (stablecoinAddress, withSigner = false) => {
  return getContract(stablecoinAddress, erc20ABI, withSigner);
};

export async function approveFinancingManager() {
    const contract = await getFractionTokenContract();
    const tx = await contract.setApprovalForAll(contractAddresses.FinancingManager, true);
    return tx.wait();
}

export async function checkFinancingManagerApproval() {
    const { signer, address } = await connectWallet();
    // We need a read-only contract instance or just use the one with signer
    const contract = await getFractionTokenContract(); 
    return await contract.isApprovedForAll(address, contractAddresses.FinancingManager);
}

export async function approveStablecoin(stablecoinAddress, amount) {
    const { signer } = await connectWallet();
    const contract = new ethers.Contract(stablecoinAddress, erc20ABI, signer);
    const tx = await contract.approve(contractAddresses.FinancingManager, amount);
    return tx.wait();
}

export async function checkStablecoinAllowance(stablecoinAddress) {
    const { signer, address } = await connectWallet();
    const contract = new ethers.Contract(stablecoinAddress, erc20ABI, signer);
    // Returns a BigNumber in v5
    return await contract.allowance(address, contractAddresses.FinancingManager);
}

export async function buyFractions(tokenId, amount) {
    const contract = await getFinancingManagerContract();
    const tx = await contract.buyFractions(tokenId, amount);
    return tx.wait();
}

export async function getInvoiceFactoryContract() {
    const { signer } = await connectWallet();
    return new ethers.Contract(
        contractAddresses.InvoiceFactory, // Make sure this name matches your deployed JSON
        InvoiceFactoryArtifact.abi,
        signer
    );
}

export async function getProduceTrackingContract() {
    const { signer } = await connectWallet();
    return new ethers.Contract(
        contractAddresses.ProduceTracking, // Ensure this name matches your JSON
        ProduceTrackingArtifact.abi,
        signer
    );
}

export async function getFractionTokenContract() {
    const { signer } = await connectWallet();
    return new ethers.Contract(
        contractAddresses.FractionToken, // Must match deployed/contract-addresses.json
        FractionTokenArtifact.abi,
        signer
    );
}

export const erc20ABI = ERC20Artifact.abi;

export async function getErc20Contract(tokenAddress) {
    const { signer } = await connectWallet();
    return new ethers.Contract(tokenAddress, erc20ABI, signer);
}

export async function disconnectWallet() {
    if (web3Modal) {
        web3Modal.clearCachedProvider();
    }
    provider = null;
}