import React from 'react';
import { useReadContract } from 'wagmi';
import { isAddress } from 'viem';
import ERC20Artifact from '../../../../deployed/ERC20.json';

const TokenAmount = ({ amount, tokenAddress }) => {
    const isAddr = tokenAddress && isAddress(tokenAddress);

    const { data: symbol } = useReadContract({
        address: tokenAddress,
        abi: ERC20Artifact.abi,
        functionName: 'symbol',
        query: {
            enabled: !!isAddr,
            staleTime: Infinity,
        }
    });

    const displaySymbol = isAddr ? (symbol || '...') : tokenAddress;

    return (
        <span>
            {parseFloat(amount).toFixed(2)} <strong>{displaySymbol}</strong>
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
                            tokenAddress={quotation.token_address}
                        />
                    </p>
                    {/* --- End of update --- */}

                    <p><strong>Seller:</strong> {quotation.seller_address}</p>
                    <button
                        onClick={() => onApprove(quotation.id)}
                        className="bg-blue-500 hover:bg-blue-900 text-white px-4 py-2 rounded mt-2 font-semibold"
                    >
                        Approve Quotation
                    </button>
                    <button onClick={() => onReject(quotation.id)} className="bg-red-600 hover:bg-red-900 text-white font-semibold ml-2 px-4 py-2 rounded mt-2">Reject Quotation</button>
                </div>
            ))}
            {quotations.length === 0 && <p>No pending quotations to approve.</p>}
        </div>
    );
};

export default BuyerQuotationApproval;
