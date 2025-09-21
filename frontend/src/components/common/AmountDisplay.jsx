import React, { useState, useEffect } from 'react';

// Custom hook to fetch crypto conversion rates
const useMaticToInrConverter = () => {
    const [conversionRate, setConversionRate] = useState(null);
    const [loading, setLoading] = useState(true);
  
    useEffect(() => {
        // In a real app, you would fetch this from a live price API (e.g., CoinGecko)
        const fetchRate = async () => {
            try {
                // Mocking the API call with a static rate and a delay
                await new Promise(resolve => setTimeout(resolve, 400)); 
                const mockRate = 50.75; // Example: 1 MATIC = ₹50.75 INR
                setConversionRate(mockRate);
            } catch (error) {
                console.error("Failed to fetch conversion rate", error);
                setConversionRate(50); // Provide a fallback rate on error
            } finally {
                setLoading(false);
            }
        };
  
        fetchRate();
    }, []);
  
    return { conversionRate, loading };
};

// A small component to display the amount in both currencies
const AmountDisplay = ({ maticAmount }) => {
    const { conversionRate, loading } = useMaticToInrConverter();
  
    if (loading) {
        return <span className="text-xs text-gray-400">Calculating...</span>;
    }
  
    const inrAmount = conversionRate ? parseFloat(maticAmount) * conversionRate : 0;
  
    return (
        <div className="flex flex-col">
            <span className="font-semibold text-gray-800">{parseFloat(maticAmount).toFixed(2)} MATIC</span>
            {conversionRate && (
                <span className="text-xs text-gray-500">≈ ₹{inrAmount.toFixed(2)} INR</span>
            )}
        </div>
    );
};

export default AmountDisplay;