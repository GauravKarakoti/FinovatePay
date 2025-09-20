import React from 'react';

const BuyerQuotationApproval = ({ quotations, onApprove }) => {
    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold mb-4">Pending Quotation Approvals</h3>
            {quotations.map(quotation => (
                <div key={quotation.id} className="border-b border-gray-200 py-4">
                    <p><strong>Description:</strong> {quotation.description}</p>
                    <p><strong>Amount:</strong> ${parseFloat(quotation.total_amount).toFixed(2)}</p>
                    <p><strong>Seller:</strong> {quotation.seller_address}</p>
                    <button
                        onClick={() => onApprove(quotation.id)}
                        className="bg-blue-500 text-white px-4 py-2 rounded mt-2"
                    >
                        Approve Quotation
                    </button>
                </div>
            ))}
            {quotations.length === 0 && <p>No pending quotations to approve.</p>}
        </div>
    );
};

export default BuyerQuotationApproval;