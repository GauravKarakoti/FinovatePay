import { useState } from 'react';
import { toast } from 'sonner';

const TokenizeInvoiceModal = ({ invoice, onClose, onSubmit, isSubmitting }) => {
    // Set a default maturity date to 30 days from now
    const defaultMaturity = new Date();
    defaultMaturity.setDate(defaultMaturity.getDate() + 30);
    const defaultMaturityString = defaultMaturity.toISOString().split('T')[0];

    const [faceValue, setFaceValue] = useState(invoice.amount || '');
    const [maturityDate, setMaturityDate] = useState(defaultMaturityString);

    const handleSubmit = (e) => {
        e.preventDefault();
        
        if (!faceValue || +faceValue < +invoice.amount) {
            toast.error("Face value must be equal to or greater than the invoice amount.");
            return;
        }
        if (!maturityDate) {
            toast.error("Please select a maturity date.");
            return;
        }

        // Pass the data up to the parent component's submit handler
        onSubmit(invoice.invoice_id, {
            faceValue,
            maturityDate
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Tokenize Invoice</h3>
                <p className="text-gray-600 mb-2">
                    Invoice ID: <span className="font-mono">{invoice.invoice_id.substring(0, 8)}...</span>
                </p>
                <p className="text-gray-600 mb-4">
                    Amount: <span className="font-semibold">{invoice.amount} {invoice.currency}</span>
                </p>
                
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="faceValue">
                            Face Value (Total Token Supply)
                        </label>
                        <input
                            id="faceValue"
                            type="number"
                            step="0.01"
                            min={invoice.amount}
                            value={faceValue}
                            onChange={(e) => setFaceValue(e.target.value)}
                            className="block w-full text-sm p-2 border rounded-md"
                            placeholder="e.g., 1000.00"
                        />
                         <p className="text-xs text-gray-500 mt-1">This is the total value investors will fund.</p>
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="maturityDate">
                            Maturity Date
                        </label>
                        <input
                            id="maturityDate"
                            type="date"
                            value={maturityDate}
                            onChange={(e) => setMaturityDate(e.target.value)}
                            className="block w-full text-sm p-2 border rounded-md"
                        />
                    </div>

                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn-primary"
                        >
                            {isSubmitting ? 'Tokenizing...' : 'Tokenize & List'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TokenizeInvoiceModal;