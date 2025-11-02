const FinancingTab = ({ invoices, onTokenizeClick }) => {
    
    // Invoices eligible for tokenization (must be deposited, not yet tokenized)
    const eligibleInvoices = invoices.filter(
        inv => inv.escrow_status === 'deposited' && !inv.is_tokenized
    );

    // Invoices already tokenized and listed
    const listedInvoices = invoices.filter(
        inv => inv.is_tokenized && inv.financing_status === 'listed'
    );

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Invoice Financing</h2>
            
            {/* Section 1: Eligible Invoices */}
            <div className="bg-white shadow rounded-lg p-6 mb-8">
                <h3 className="text-xl font-semibold mb-4">Eligible to Tokenize</h3>
                <div className="space-y-4">
                    {eligibleInvoices.length > 0 ? (
                        eligibleInvoices.map(invoice => (
                            <div key={invoice.invoice_id} className="flex justify-between items-center p-4 border rounded-md">
                                <div>
                                    <p className="font-semibold">Invoice {invoice.invoice_id.substring(0, 8)}...</p>
                                    <p className="text-sm text-gray-600">Amount: {invoice.amount} {invoice.currency}</p>
                                    <p className="text-sm text-gray-600">Status: <span className="font-medium text-green-600">Deposited in Escrow</span></p>
                                </div>
                                <button
                                    onClick={() => onTokenizeClick(invoice)}
                                    className="btn-primary"
                                >
                                    Tokenize
                                </button>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500">No invoices are currently eligible for tokenization. An invoice must be deposited by the buyer in escrow first.</p>
                    )}
                </div>
            </div>

            {/* Section 2: Listed on Marketplace */}
            <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Listed on Marketplace</h3>
                <div className="space-y-4">
                    {listedInvoices.length > 0 ? (
                        listedInvoices.map(invoice => (
                            <div key={invoice.invoice_id} className="flex justify-between items-center p-4 border rounded-md bg-gray-50">
                                <div>
                                    <p className="font-semibold">Invoice {invoice.invoice_id.substring(0, 8)}...</p>
                                    <p className="text-sm text-gray-600">Face Value: {invoice.face_value} {invoice.currency}</p>
                                    <p className="text-sm text-gray-600">Token ID: {invoice.token_id}</p>
                                </div>
                                <span className="text-sm font-medium text-blue-600 px-3 py-1 bg-blue-100 rounded-full">
                                    Listed
                                </span>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500">You have no invoices currently listed on the marketplace.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FinancingTab;