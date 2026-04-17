import { ethers } from 'ethers';
import FNSaleArtifact from '../../../deployed/FNSale.json';

export const purchaseFNTokens = async (ethAmountStr, saleContractAddress) => {
  if (!window.ethereum) throw new Error("Wallet not found");

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const saleContract = new ethers.Contract(
    saleContractAddress,
    FNSaleArtifact.abi,
    signer
  );

  const tx = await saleContract.buyTokens({
    value: ethers.parseEther(ethAmountStr)
  });

  return await tx.wait();
};