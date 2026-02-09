import { ethers } from "ethers";
import escrowAbi from "../abi/EscrowContract.json";

export async function gaslessDeposit(
  signer,
  escrowAddress,
  invoiceId,
  amount
) {
  const userAddress = await signer.getAddress();

  const escrowContract = new ethers.Contract(
    escrowAddress,
    escrowAbi,
    signer
  );

  const escrowInterface = new ethers.Interface(escrowAbi);

  const functionData = escrowInterface.encodeFunctionData("deposit", [
    invoiceId,
    amount
  ]);

  const nonce = await escrowContract.nonces(userAddress);

  const domain = {
    name: "FinovatePay",
    version: "1",
    chainId: 80001,
    verifyingContract: escrowAddress
  };

  const types = {
    MetaTx: [
      { name: "user", type: "address" },
      { name: "functionData", type: "bytes" },
      { name: "nonce", type: "uint256" }
    ]
  };

  const signature = await signer.signTypedData(domain, types, {
    user: userAddress,
    functionData,
    nonce
  });

  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: userAddress,
      functionData,
      signature
    })
  });

  return await res.json();
}
