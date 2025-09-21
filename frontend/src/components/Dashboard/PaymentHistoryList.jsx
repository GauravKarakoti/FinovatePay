import AmountDisplay from '../common/AmountDisplay'; // <-- IMPORT the reusable component

const PaymentHistoryList = ({ invoices, userRole }) => {
    const formatAddress = (address) => {
        if (!address) return 'N/A';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    };
    const formatDate = (dateString) => new Date(dateString).toLocaleDateString();
    const blockExplorerUrl = 'https://amoy.polygonscan.com/tx/';

    return (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold">Completed Payments</h3>
            </div>
            {invoices.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Completion Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Counterparty</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {invoices.map((invoice) => (
                                <tr key={invoice.invoice_id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatDate(invoice.updated_at)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{formatAddress(invoice.invoice_id)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                       {/* ✅ UPDATED HERE */}
                                       <AmountDisplay maticAmount={invoice.amount} />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatAddress(userRole === 'buyer' ? invoice.seller_address : invoice.buyer_address)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600">
                                        <a href={`${blockExplorerUrl}${invoice.release_tx_hash}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                            View on Explorer
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-center py-12 text-gray-500">
                    <p>No completed payments found.</p>
                </div>
            )}
        </div>
    );
};

export default PaymentHistoryList;