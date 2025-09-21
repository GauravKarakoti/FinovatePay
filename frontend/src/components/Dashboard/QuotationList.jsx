import AmountDisplay from '../common/AmountDisplay'; // <-- IMPORT the reusable component

const QuotationList = ({ quotations, userRole, onApprove, onReject, onCreateInvoice }) => {
    const formatAddress = (address) => {
        if (!address) return 'N/A';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    };

    const getStatusBadge = (status) => {
        const config = {
            pending_seller_approval: 'bg-yellow-100 text-yellow-800',
            pending_buyer_approval: 'bg-blue-100 text-blue-800',
            approved: 'bg-green-100 text-green-800',
            rejected: 'bg-red-100 text-red-800',
            invoiced: 'bg-indigo-100 text-indigo-800',
        };
        const label = status.replace(/_/g, ' ');
        const color = config[status] || 'bg-gray-100 text-gray-800';
        return <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${color}`}>{label}</span>;
    };

    return (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Counterparty</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {quotations.map((q) => (
                            <tr key={q.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{q.produce_type || q.description}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" title={userRole === 'seller' ? q.buyer_address : q.seller_address}>
                                    {formatAddress(userRole === 'seller' ? q.buyer_address : q.seller_address)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <AmountDisplay maticAmount={q.total_amount} />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(q.status)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                    {/* SELLER ACTIONS */}
                                    {userRole === 'seller' && q.status === 'pending_seller_approval' && (
                                        <>
                                            <button onClick={() => onApprove(q.id)} className="text-green-600 hover:text-green-900">Approve</button>
                                            <button onClick={() => onReject(q.id)} className="text-red-600 hover:text-red-900">Reject</button>
                                        </>
                                    )}
                                    {userRole === 'seller' && q.status === 'approved' && (
                                        <button onClick={() => onCreateInvoice(q)} className="text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-md text-xs">
                                            Create Invoice
                                        </button>
                                    )}

                                    {/* BUYER ACTIONS */}
                                    {userRole === 'buyer' && q.status === 'pending_buyer_approval' && (
                                        <>
                                            <button onClick={() => onApprove(q.id)} className="text-green-600 hover:text-green-900">Approve</button>
                                            <button onClick={() => onReject(q.id)} className="text-red-600 hover:text-red-900">Reject</button>
                                        </>
                                    )}
                                    {(userRole === 'buyer' && q.status === 'pending_seller_approval') && (
                                       <button onClick={() => onReject(q.id)} className="text-red-600 hover:text-red-900">Cancel</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {quotations.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p>No quotations found</p>
                </div>
            )}
        </div>
    );
};

export default QuotationList;