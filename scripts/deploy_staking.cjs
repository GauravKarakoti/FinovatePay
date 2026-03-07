const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const governanceTokenAddress = process.env.GOVERNANCE_TOKEN_ADDRESS;
  if (!governanceTokenAddress) {
    throw new Error('GOVERNANCE_TOKEN_ADDRESS must be set in env');
  }

  const Staking = await hre.ethers.getContractFactory('InvoiceTokenStaking');
  const staking = await Staking.deploy(governanceTokenAddress);
  await staking.deployed();

  console.log('InvoiceTokenStaking deployed to:', staking.address);

  // Save address and ABI to deployed folder for backend use
  const deployedDir = path.join(__dirname, '..', 'deployed');
  if (!fs.existsSync(deployedDir)) fs.mkdirSync(deployedDir);

  const artifact = await hre.artifacts.readArtifact('InvoiceTokenStaking');
  fs.writeFileSync(path.join(deployedDir, 'InvoiceTokenStaking.json'), JSON.stringify(artifact, null, 2));

  // Update contract-addresses.json if present
  const addressesPath = path.join(deployedDir, 'contract-addresses.json');
  let addresses = {};
  if (fs.existsSync(addressesPath)) addresses = JSON.parse(fs.readFileSync(addressesPath));
  addresses.InvoiceTokenStaking = staking.address;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
