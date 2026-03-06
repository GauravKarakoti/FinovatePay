import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Transak } from '@transak/ui-js-sdk';
import api, { createFiatRampLink } from '../../utils/api';
import CurrencySelector from '../Settings/CurrencySelector';

const FiatOnRampModal = ({ onClose, onSuccess, walletAddress }) => {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [cryptoCurrency, setCryptoCurrency] = useState('USDC');
    const [provider, setProvider] = useState('moonpay'); // Default to MoonPay
    const [isProcessing, setIsProcessing] = useState(false);
    
    // State for live exchange rate
    const [exchangeRate, setExchangeRate] = useState(1.0);
    const [isLoadingRate, setIsLoadingRate] = useState(false);

    // Fee percentages by provider
    const FEE_PERCENT = 
        provider === 'moonpay' ? 0.0149 : 
        provider === 'transak' ? 0.035 : 
        0.015;

    // --- 1. ACTUAL IMPLEMENTATION: Live Exchange Rate Fetching ---
    useEffect(() => {
        const fetchExchangeRate = async () => {
            // USDC is pegged to USD, so rate is always 1
            if (currency === 'USD') {
                setExchangeRate(1.0);
                return;
            }

            setIsLoadingRate(true);
            try {
                // Fetching real-time rates from CoinGecko (Free Tier)
                // "ids" is the crypto (usdc), "vs_currencies" is the fiat (eur, gbp)
                const response = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=${currency.toLowerCase()}`
                );
                const data = await response.json();
                
                // The API returns how much 1 USDC costs in Fiat. 
                // We need the inverse: How much USDC you get for 1 Fiat.
                // Rate = 1 / (Fiat price of 1 USDC)
                const rateInFiat = data['usd-coin'][currency.toLowerCase()];
                setExchangeRate(1 / rateInFiat);
            } catch (error) {
                console.error("Failed to fetch exchange rate:", error);
                toast.error("Could not fetch live rates. Defaulting to 1:1.");
                setExchangeRate(1.0);
            } finally {
                setIsLoadingRate(false);
            }
        };

        fetchExchangeRate();
    }, [currency]);

    // --- 2. Handle Purchase with Provider Selection ---
    const handlePurchase = async (e) => {
        e.preventDefault();
        
        if (!amount || parseFloat(amount) <= 0) {
            toast.error("Please enter a valid amount");
            return;
        }

        if (!walletAddress) {
            toast.error("Please connect your wallet first");
            return;
        }

        setIsProcessing(true);

        try {
            let paymentUrl;

            if (provider === 'transak') {
                const transakConfig = {
                    apiKey: import.meta.env.VITE_TRANSAK_API_KEY,
                    environment: 'STAGING',
                    defaultCryptoCurrency: cryptoCurrency,
                    walletAddress: walletAddress,
                    themeColor: '22c55e',
                    fiatAmount: parseFloat(amount),
                    fiatCurrency: currency,
                    email: '', // Let user enter email in widget
                    redirectURL: window.location.origin,
                    hostURL: window.location.origin,
                    widgetHeight: '625px',
                    widgetWidth: '500px',
                    network: 'polygon'
                };

                const transak = new Transak(transakConfig);

                transak.init();

                transak.on(transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL, (orderData) => {
                    if (import.meta.env.DEV) {
                        console.log('Transak order successful:', { orderId: orderData?.id });
                    }
                    transak.close();
                    toast.success("Payment successful via Transak!");
                    if (onSuccess) onSuccess(parseFloat(amount));
                    onClose();
                });

                transak.on(transak.EVENTS.TRANSAK_WIDGET_CLOSE, () => {
                    transak.close();
                    setIsProcessing(false);
                });

                return;
            } else if (provider === 'moonpay') {
                // Use MoonPay backend endpoint
                const response = await createFiatRampLink({
                    amount: parseFloat(amount),
                    currency,
                    cryptoCurrency,
                    walletAddress
                });

                const { paymentUrl: moonpayUrl } = response.data;
                paymentUrl = moonpayUrl;

                if (paymentUrl) {
                    toast.loading("Redirecting to MoonPay...", { duration: 2000 });
                    window.location.href = paymentUrl;
                    return;
                }
            } else {
                // Use Stripe backend endpoint
                const response = await api.post('/payments/onramp', {
                    amount: parseFloat(amount),
                    currency: currency,
                    targetToken: cryptoCurrency,
                    exchangeRate: exchangeRate
                });

                const { paymentUrl: stripeUrl, sessionUrl } = response.data;
                paymentUrl = stripeUrl || sessionUrl;

                if (paymentUrl) {
                    toast.loading("Redirecting to Stripe...", { duration: 2000 });
                    window.location.href = paymentUrl;
                    return;
                }
            }

            // Fallback for simulation/testing
            console.warn("No payment URL returned. Falling back to simulation.");
            toast.success("Payment successful! (Simulated)");
            if (onSuccess) onSuccess(parseFloat(amount));
            onClose();

        } catch (error) {
            console.error('Payment initialization failed:', error);
            const errorMessage = error.response?.data?.error || "Payment connection failed. Please try again.";
            toast.error(errorMessage);
            setIsProcessing(false);
        } finally {
            if (provider !== 'transak') {
                setIsProcessing(false);
            }
        }
    };

    // Calculate totals based on the dynamic exchange rate
    const fees = amount ? (parseFloat(amount) * FEE_PERCENT) : 0;
    const totalCharge = amount ? (parseFloat(amount) + fees) : 0; // Total Fiat to pay
    const estimatedTokens = amount ? (parseFloat(amount) * exchangeRate) : 0; // Tokens received

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
                
                <div className="text-sm text-gray-600 mb-6 bg-blue-50 p-3 rounded-lg border border-blue-100">
                    <p className="font-semibold mb-1">Testing on Amoy?</p>
                    <p>Since this is a testnet demo, you can get free USDC directly from the faucet.</p>
                    <a 
                        href="https://faucet.circle.com/" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline mt-1 block"
                    >
                        Go to Circle USDC Faucet &rarr;
                    </a>
                </div>

                <form onSubmit={handlePurchase}>
                    {/* Provider Selection */}
                    <div className="mb-5">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Payment Provider
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            <button
                                type="button"
                                onClick={() => setProvider('moonpay')}
                                className={`py-3 px-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-1
                                    ${provider === 'moonpay' 
                                        ? 'border-green-500 bg-green-50 text-green-700' 
                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                    }`}
                            >
                                <span className="font-bold">MoonPay</span>
                                <span className="text-xs opacity-75">1.49% fee</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setProvider('stripe')}
                                className={`py-3 px-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-1
                                    ${provider === 'stripe' 
                                        ? 'border-green-500 bg-green-50 text-green-700' 
                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                    }`}
                            >
                                <span className="font-bold">Stripe</span>
                                <span className="text-xs opacity-75">1.5% fee</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setProvider('transak')}
                                className={`py-3 px-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-1
                                    ${provider === 'transak' 
                                        ? 'border-green-500 bg-green-50 text-green-700' 
                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                    }`}
                            >
                                <span className="font-bold">Transak</span>
                                <span className="text-xs opacity-75">Global / UPI</span>
                            </button>
                        </div>
                    </div>

                    {/* Crypto Selection */}
                    <div className="mb-5">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Buy Crypto
                        </label>
                        <select
                            value={cryptoCurrency}
                            onChange={(e) => setCryptoCurrency(e.target.value)}
                            className="block w-full py-3 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-all text-lg font-medium bg-white"
                        >
                            <option value="USDC">USDC</option>
                            <option value="USDT">USDT</option>
                        </select>
                    </div>

                    <div className="mb-5">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            You Pay (Fiat)
                        </label>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <input
                                    type="number"
                                    min="10"
                                    step="any"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="block w-full pl-4 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-all text-lg font-medium"
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="w-36">
                                <CurrencySelector
                                    value={currency}
                                    onChange={setCurrency}
                                    showFiatOnly={true}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-200 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Exchange Rate</span>
                            <span className="font-medium text-gray-700">
                                {isLoadingRate 
                                    ? "Fetching..." 
                                    : `1 ${currency} ≈ ${exchangeRate.toFixed(4)} USDC`
                                }
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Processing Fee ({provider === 'transak' ? '3.5%' : provider === 'moonpay' ? '1.49%' : '1.5%'})</span>
                            <span className="font-medium text-gray-700">{fees.toFixed(2)} {currency}</span>
                        </div>
                        <div className="border-t border-gray-200 my-2"></div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-gray-800">Total Charged</span>
                            <span className="font-bold text-xl text-finovate-blue-700">{totalCharge.toFixed(2)} {currency}</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                            <span className="text-sm font-medium text-green-600">You Receive (Est.)</span>
                            <span className="text-sm font-bold text-green-600">
                                {estimatedTokens.toFixed(2)} USDC
                            </span>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isProcessing || isLoadingRate}
                        className={`w-full py-3 px-4 rounded-lg shadow-lg text-white font-bold text-lg transition-all transform hover:-translate-y-0.5
                            ${(isProcessing || isLoadingRate)
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
                        ) : `Pay with ${provider === 'moonpay' ? 'MoonPay' : provider === 'transak' ? 'Transak' : 'Stripe'}`}
                    </button>
                    
                    <p className="text-xs text-center text-gray-400 mt-4 flex items-center justify-center gap-2">
                        <span>Powered by</span> 
                        <span className="font-bold text-gray-500">{provider === 'moonpay' ? 'MoonPay' : provider === 'transak' ? 'Transak' : 'Stripe'}</span>
                    </p>
                </form>
            </div>
        </div>
    );
};

export default FiatOnRampModal;