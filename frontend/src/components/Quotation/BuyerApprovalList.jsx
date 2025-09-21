import AmountDisplay from '../common/AmountDisplay'; // <-- IMPORT the reusable component

const BuyerApprovalList = ({ quotations, onApprove, onReject }) => {
    const formatAddress = (address) => {
        if (!address) return 'N/A';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    };

    return (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">From Seller</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {quotations.map((q) => (
                            <tr key={q.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{q.description}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" title={q.seller_address}>
                                    {q.seller_name || formatAddress(q.seller_address)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    {/* ✅ UPDATED HERE */}
                                    <AmountDisplay maticAmount={q.total_amount} />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-4">
                                    <button onClick={() => onApprove(q.id)} className="text-green-600 hover:text-green-900 font-semibold">Approve</button>
                                    <button onClick={() => onReject(q.id)} className="text-red-600 hover:text-red-900 font-semibold">Reject</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {quotations.length === 0 && (
                <div className="text-center py-16 text-gray-500">
                    <p className="text-lg">You have no pending approvals.</p>
                    <p className="text-sm">Quotations sent by sellers for off-platform deals will appear here.</p>
                </div>
            )}
        </div>
    );
};

export default BuyerApprovalList;