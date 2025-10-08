import AmountDisplay from '../common/AmountDisplay';

const InvoiceList = ({
    invoices,
    userRole,
    onSelectInvoice,
    onPayInvoice,
    onConfirmRelease,
    onRaiseDispute,
    onShowQRCode,
    onConfirmShipment
}) => {
    if (!invoices || invoices.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
                <p className="text-gray-500">No invoices to display.</p>
            </div>
        );
    }

    const formatAddress = (address) => {
        if (!address) return 'N/A';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    };

    const getStatusChip = (status) => {
        const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
        switch (status) {
            case 'created': return <span className={`${baseClasses} bg-blue-100 text-blue-800`}>Pending</span>;
            case 'deposited': return <span className={`${baseClasses} bg-yellow-100 text-yellow-800`}>In Escrow</span>;
            case 'shipped': return <span className={`${baseClasses} bg-indigo-100 text-indigo-800`}>Shipped</span>;
            case 'released': return <span className={`${baseClasses} bg-green-100 text-green-800`}>Completed</span>;
            case 'disputed': return <span className={`${baseClasses} bg-red-100 text-red-800`}>Disputed</span>;
            default: return <span className={`${baseClasses} bg-gray-100 text-gray-800`}>Unknown</span>;
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice ID</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Produce</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {invoices.map((invoice) => (
                            <tr key={invoice.invoice_id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onSelectInvoice(invoice)}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">#{formatAddress(invoice.invoice_id)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{invoice.description}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <AmountDisplay maticAmount={invoice.amount} />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">{getStatusChip(invoice.escrow_status)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                    {userRole === 'buyer' && invoice.escrow_status === 'created' && (
                                        <button onClick={(e) => { e.stopPropagation(); onPayInvoice(invoice); }} className="text-white bg-green-600 hover:bg-green-700 px-3 py-1 rounded-md text-xs">Pay Invoice</button>
                                    )}
                                    {userRole === 'seller' && invoice.escrow_status === 'deposited' && onConfirmShipment && (
                                        <button
                                            onClick={() => onConfirmShipment(invoice)}
                                            className="text-purple-600 hover:text-purple-900"
                                        >
                                            Confirm Shipment
                                        </button>
                                    )}
                                    {userRole === 'buyer' && invoice.escrow_status === 'shipped' && (
                                        <button onClick={(e) => { e.stopPropagation(); onConfirmRelease(invoice); }} className="text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-md text-xs">Release Funds</button>
                                    )}
                                    {['deposited', 'shipped'].includes(invoice.escrow_status) && (
                                        <button onClick={(e) => { e.stopPropagation(); onRaiseDispute(invoice); }} className="text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md text-xs">Raise Dispute</button>
                                    )}
                                    <button onClick={(e) => { e.stopPropagation(); onShowQRCode(invoice); }} className="text-white bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded-md text-xs">
                                        Show QR
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InvoiceList;