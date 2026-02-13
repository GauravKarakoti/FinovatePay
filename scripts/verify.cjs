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
  
  // Verify EscrowContract with its constructor argument
  await verify(addresses.EscrowContract, [addresses.ComplianceManager]);
  
  
  // Verify FractionToken
  await verify(addresses.FractionToken, []);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
