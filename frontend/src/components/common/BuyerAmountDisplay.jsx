import React, { useState, useEffect } from 'react';

const useInrToMaticConverter = () => {
    const [conversionRate, setConversionRate] = useState(null);
    const [loading, setLoading] = useState(true);
  
    useEffect(() => {
        // In a real app, you would fetch this from a live price API (e.g., CoinGecko)
        const fetchRate = async () => {
            try {
                // Mocking the API call with a static rate and a delay
                await new Promise(resolve => setTimeout(resolve, 400)); 
                const mockRate = 1/50.75; // Example: 1 MATIC = ₹50.75 INR
                setConversionRate(mockRate);
            } catch (error) {
                console.error("Failed to fetch conversion rate", error);
                setConversionRate(1/50); // Provide a fallback rate on error
            } finally {
                setLoading(false);
            }
        };
  
        fetchRate();
    }, []);
  
    return { conversionRate, loading };
};

const BuyerAmountDisplay = ({ InrAmount }) => {
    const { conversionRate, loading } = useInrToMaticConverter();
  
    if (loading) {
        return <span className="text-xs text-gray-400">Calculating...</span>;
    }
  
    const maticAmount = conversionRate ? parseFloat(InrAmount) * conversionRate : 0;
  
    return (
        <div className="flex flex-col">
            <span className="font-semibold text-gray-800">{parseFloat(InrAmount).toFixed(2)} INR</span>
            {conversionRate && (
                <span className="text-xs text-gray-500">≈ ₹{maticAmount.toFixed(2)} MATIC</span>
            )}
        </div>
    );
};

export default BuyerAmountDisplay;