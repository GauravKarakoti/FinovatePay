import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { erc20ABI } from '../../utils/web3'; // Import the updated ABI

// A helper to get the symbol if it's an address
const useTokenSymbol = (tokenAddress) => {
    const [symbol, setSymbol] = useState(tokenAddress);

    useEffect(() => {
        if (ethers.isAddress(tokenAddress)) {
            const fetchSymbol = async () => {
                try {
                    // Use a generic provider for read-only calls
                    const rpcUrl = import.meta.env.VITE_POLYGON_RPC_URL || process.env.REACT_APP_POLYGON_RPC_URL;
                    if (!rpcUrl) {
                        setSymbol("UNKNOWN");
                        return;
                    }
                    const provider = new ethers.JsonRpcProvider(rpcUrl); 
                    const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, provider);
                    const tokenSymbol = await tokenContract.symbol();
                    setSymbol(tokenSymbol);
                } catch (err) {
                    console.error("Error fetching token symbol:", err);
                    setSymbol("UNKNOWN");
                }
            };
            fetchSymbol();
        } else {
            setSymbol(tokenAddress); // It's already a symbol like 'MATIC'
        }
    }, [tokenAddress]);

    return symbol;
};

// New component to display amount with symbol
const TokenAmount = ({ amount, tokenAddress }) => {
    const symbol = useTokenSymbol(tokenAddress);
    return (
        <span>
            {parseFloat(amount).toFixed(2)} <strong>{symbol}</strong>
        </span>
    );
};


const BuyerQuotationApproval = ({ quotations, onApprove, onReject }) => {
    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold mb-4">Pending Quotation Approvals</h3>
            {quotations.map(quotation => (
                <div key={quotation.id} className="border-b border-gray-200 py-4">
                    <p><strong>Description:</strong> {quotation.description}</p>
                    
                    {/* --- UPDATED: Use the new TokenAmount component --- */}
                    <p><strong>Amount:</strong> 
                        <TokenAmount 
                            amount={quotation.total_amount} 
                            tokenAddress={quotation.token_address} // <-- Assumes your API now returns this
                        />
                    </p>
                    {/* --- End of update --- */}

                    <p className="break-all"><strong>Seller:</strong> {quotation.seller_address}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                        <button
                            onClick={() => onApprove(quotation.id)}
                            className="bg-blue-500 hover:bg-blue-900 text-white px-4 py-2 rounded font-semibold text-sm flex-1 sm:flex-none justify-center"
                        >
                            Approve Quotation
                        </button>
                        <button 
                            onClick={() => onReject(quotation.id)} 
                            className="bg-red-600 hover:bg-red-900 text-white font-semibold px-4 py-2 rounded text-sm flex-1 sm:flex-none justify-center"
                        >
                            Reject Quotation
                        </button>
                    </div>
                </div>
            ))}
            {quotations.length === 0 && <p>No pending quotations to approve.</p>}
        </div>
    );
};

export default BuyerQuotationApproval;