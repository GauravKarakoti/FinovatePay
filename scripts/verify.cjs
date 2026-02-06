const { run } = require("hardhat");

async function verify(address, constructorArguments) {
  console.log(`Verifying contract at ${address}...`);
  
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log("Contract verified successfully!");
  } catch (error) {
    if (error.message.toLowerCase().includes("already verified")) {
      console.log("Contract already verified");
    } else {
      console.error("Verification failed:", error);
    }
  }
}

async function main() {
  // Get deployed addresses
  const addresses = require("../deployed/contract-addresses.json");
  
  // Verify ComplianceManager
  await verify(addresses.ComplianceManager, []);
  
  // Verify InvoiceFactory
  await verify(addresses.InvoiceFactory, []);

  // Verify EscrowContract with its constructor arguments
  await verify(addresses.EscrowContract, [addresses.ComplianceManager, addresses.InvoiceFactory]);
  
  // Verify FractionToken
  await verify(addresses.FractionToken, []);

  // Verify ProduceTracking
  await verify(addresses.ProduceTracking, []);

  // Verify FinancingManager
  await verify(addresses.FinancingManager, []);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
