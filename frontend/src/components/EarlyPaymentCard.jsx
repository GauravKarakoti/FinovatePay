import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { toast } from 'sonner';

const EarlyPaymentCard = ({ invoiceId }) => {
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOffer = async () => {
      try {
        // Adjust URL to match your backend port
        const res = await api.get(`/invoices/${invoiceId}/offer`);
        setOffer(res.data);
      } catch (err) {
        console.error("Error fetching offer", err);
      } finally {
        setLoading(false);
      }
    };
    fetchOffer();
  }, [invoiceId]);

  const handleAccept = async () => {
    try {
      await api.post(`/invoices/${invoiceId}/settle-early`);
      toast.success("Offer Accepted! Payment is being processed.");
      window.location.reload(); 
    } catch (err) {
      // Error is already handled by api interceptor
    }
  };

  if (loading) return <div className="p-4">Checking for offers...</div>;
  if (!offer || !offer.eligible) return null; // Hide if not eligible

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-indigo-100 rounded-xl p-6 shadow-sm mt-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-bold text-indigo-900">🚀 Get Paid Early</h3>
          <p className="text-sm text-indigo-700 mt-1">
            Accept payment now and save the buyer <span className="font-bold">${offer.discountAmount}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase font-semibold">New Total</p>
          <p className="text-3xl font-extrabold text-green-600">${offer.finalAmount}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-indigo-100 pt-4">
        <div className="flex gap-3">
          <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold">
            {offer.daysEarly} Days Early
          </span>
          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">
            {offer.apr}% APR
          </span>
        </div>
        <button 
          onClick={handleAccept}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg shadow-lg transition-all"
        >
          Accept Offer
        </button>
      </div>
    </div>
  );
};

export default EarlyPaymentCard;