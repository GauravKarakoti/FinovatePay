import { useState } from 'react';
import { toast } from 'sonner';

const FiatOnRampModal = ({ onClose, onSuccess }) => {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [isProcessing, setIsProcessing] = useState(false);

    // Mock exchange rate (1 Fiat = 1 USDC for simplicity)
    const EXCHANGE_RATE = 1.0;
    const FEE_PERCENT = 0.015; // 1.5% fee

    const handlePurchase = async (e) => {
        e.preventDefault();
        
        if (!amount || parseFloat(amount) <= 0) {
            toast.error("Please enter a valid amount");
            return;
        }

        setIsProcessing(true);

        try {
            // 1. Create a payment session/intent on the backend
            // (Using the VITE_API_URL pattern implied by existing code)
            const apiUrl = import.meta.env.VITE_API_URL;
            const response = await axios.post(`${apiUrl}/payment/onramp`, {
                amount: parseFloat(amount),
                currency: currency,
                paymentMethod: 'card' // Example field
            });

            const { paymentUrl, clientSecret } = response.data;

            // 2. Redirect user to payment provider (e.g., Stripe Checkout)
            if (paymentUrl) {
                window.location.href = paymentUrl;
            } else {
                // If using an embedded flow (like Stripe Elements), handle clientSecret here
                toast.success("Order created! Redirecting to payment...");
                
                // For demonstration, we simulate success callback if no redirect URL is provided
                if (onSuccess) onSuccess(parseFloat(amount));
                onClose();
            }

        } catch (error) {
            console.error('Payment initialization failed:', error);
            toast.error(error.response?.data?.error || "Payment failed. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };

    const fees = amount ? (parseFloat(amount) * FEE_PERCENT) : 0;
    const totalCharge = amount ? (parseFloat(amount) + fees) : 0;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center space-x-2">
                        <div className="bg-green-100 p-2 rounded-full">
                            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-gray-800">Buy Stablecoins</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <p className="text-sm text-gray-600 mb-6 bg-blue-50 p-3 rounded-lg border border-blue-100">
                    Top up your wallet instantly using your credit card to finance invoices or pay suppliers.
                </p>

                <form onSubmit={handlePurchase}>
                    <div className="mb-5">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            You Pay
                        </label>
                        <div className="relative group">
                            <input
                                type="number"
                                min="10"
                                step="any"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="block w-full pl-4 pr-20 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-all text-lg font-medium"
                                placeholder="0.00"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center border-l border-gray-300">
                                <select
                                    value={currency}
                                    onChange={(e) => setCurrency(e.target.value)}
                                    className="h-full py-0 pl-3 pr-8 bg-gray-50 text-gray-600 font-medium rounded-r-lg focus:ring-0 border-transparent cursor-pointer hover:bg-gray-100"
                                >
                                    <option value="USD">USD</option>
                                    <option value="EUR">EUR</option>
                                    <option value="GBP">GBP</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-200 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Rate</span>
                            <span className="font-medium text-gray-700">1 {currency} ≈ {EXCHANGE_RATE.toFixed(2)} USDC</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Processing Fee (1.5%)</span>
                            <span className="font-medium text-gray-700">{fees.toFixed(2)} {currency}</span>
                        </div>
                        <div className="border-t border-gray-200 my-2"></div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-gray-800">Total Charged</span>
                            <span className="font-bold text-xl text-finovate-blue-700">{totalCharge.toFixed(2)} {currency}</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                            <span className="text-sm font-medium text-green-600">You Receive</span>
                            <span className="text-sm font-bold text-green-600">{amount || '0.00'} USDC</span>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isProcessing}
                        className={`w-full py-3 px-4 rounded-lg shadow-lg text-white font-bold text-lg transition-all transform hover:-translate-y-0.5
                            ${isProcessing 
                                ? 'bg-gray-400 cursor-not-allowed shadow-none' 
                                : 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 shadow-green-500/30'}`}
                    >
                        {isProcessing ? (
                            <span className="flex items-center justify-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing...
                            </span>
                        ) : 'Confirm Purchase'}
                    </button>
                    
                    <p className="text-xs text-center text-gray-400 mt-4 flex items-center justify-center gap-2">
                        <span>Powered by</span> 
                        <span className="font-bold text-gray-500">Stripe</span>
                    </p>
                </form>
            </div>
        </div>
    );
};

export default FiatOnRampModal;