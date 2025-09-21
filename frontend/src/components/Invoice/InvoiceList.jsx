import AmountDisplay from '../common/AmountDisplay'; // <-- IMPORT the reusable component

const InvoiceList = ({ invoices, onSelectInvoice, onConfirmRelease, onPayInvoice, onRaiseDispute, onConfirmShipment, userRole }) => {
  const formatDate = (dateString) => new Date(dateString).toLocaleDateString();
  const formatAddress = (address) => {
      if (!address) return 'N/A';
      return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const getStatusBadge = (status) => {
      const statusConfig = {
          created: { label: 'Created', color: 'bg-yellow-100 text-yellow-800' },
          deposited: { label: 'Paid', color: 'bg-blue-100 text-blue-800' },
          shipped: { label: 'Shipped', color: 'bg-purple-100 text-purple-800' },
          released: { label: 'Completed', color: 'bg-green-100 text-green-800' },
          disputed: { label: 'Disputed', color: 'bg-red-100 text-red-800' },
          expired: { label: 'Expired', color: 'bg-gray-100 text-gray-800' },
      };
      const config = statusConfig[status] || statusConfig.created;
      return <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>{config.label}</span>;
  };

  return (
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">Invoices</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                  <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Counterparty</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {invoices.map((invoice) => (
                  <tr key={invoice.invoice_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{formatAddress(invoice.invoice_id)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatAddress(userRole === 'seller' ? invoice.buyer_address : invoice.seller_address)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {/* ✅ UPDATED HERE */}
                        <AmountDisplay maticAmount={invoice.amount} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(invoice.due_date)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(invoice.escrow_status || invoice.status)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                    <button
                        onClick={() => onSelectInvoice(invoice)}
                        className="text-finovate-blue-600 hover:text-finovate-blue-900"
                    >
                        View
                    </button>
                    
                    {invoice.escrow_status === 'created' && onPayInvoice && (
                        <button
                            onClick={() => onPayInvoice(invoice)}
                            className="text-green-600 hover:text-green-900"
                        >
                            Pay
                        </button>
                    )}
                    
                    {/* FIX: Pass the entire invoice object to onConfirmRelease */}
                    {invoice.escrow_status === 'deposited' && onConfirmRelease && userRole === 'buyer' && (
                        <button
                            onClick={() => onConfirmRelease(invoice)}
                            className="text-green-600 hover:text-green-900"
                        >
                            Confirm
                        </button>
                    )}

                    {userRole === 'seller' && invoice.escrow_status === 'deposited' && onConfirmShipment && (
                        <button
                            onClick={() => onConfirmShipment(invoice)}
                            className="text-purple-600 hover:text-purple-900"
                        >
                            Confirm Shipment
                        </button>
                    )}
                    
                    {(invoice.escrow_status === 'created' || invoice.escrow_status === 'deposited') && onRaiseDispute && (
                        <button
                            onClick={() => onRaiseDispute(invoice)}
                            className="text-red-600 hover:text-red-900"
                        >
                            Dispute
                        </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {invoices.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No invoices found</p>
        </div>
      )}
    </div>
  );
};

export default InvoiceList;