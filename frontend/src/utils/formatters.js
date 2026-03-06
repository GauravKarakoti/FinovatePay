import { ethers } from 'ethers';

/**
 * Global formatter utilities for Ethers v6 standards
 */

export const formatEther = (value) => {
  if (value === null || value === undefined) return '0';
  return ethers.formatEther(value);
};

export const parseEther = (value) => {
  if (!value) return 0n;
  return ethers.parseEther(value.toString());
};

export const formatUnits = (value, decimals = 18) => {
  if (value === null || value === undefined) return '0';
  return ethers.formatUnits(value, decimals);
};

export const parseUnits = (value, decimals = 18) => {
  if (!value) return 0n;
  return ethers.parseUnits(value.toString(), decimals);
};

export const toBigInt = (value) => {
    if (value === null || value === undefined) return 0n;
    return BigInt(value);
};

// Common hash helpers
export const keccak256 = (value) => ethers.keccak256(value);
export const toUtf8Bytes = (value) => ethers.toUtf8Bytes(value);
export const isAddress = (value) => ethers.isAddress(value);
export const zeroPadValue = (value, length) => ethers.zeroPadValue(value, length); 
