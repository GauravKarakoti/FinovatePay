import React, { useState } from 'react';
import { api } from '../../utils/api';


const ArbitratorPanel = ({ invoiceId, onResolve }) => {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  const handleResolve = async (status) => {
    if (!notes.trim()) {
      setError('Please provide a resolution note.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.post(`/dispute/${invoiceId}/resolve`, { status, notes });

      if (onResolve) onResolve(status);
      setNotes('');
    } catch (err) {
      console.error('Resolution failed', err);
      setError(err.response?.data?.error || 'Failed to resolve dispute');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6 border-2 border-yellow-200">
      <h3 className="text-xl font-bold mb-4 text-yellow-800">Arbitrator Panel</h3>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Resolution Notes</label>
        <textarea
          className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
          rows="3"
          placeholder="Explain the resolution..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

      <div className="flex space-x-4">
        <button
          onClick={() => handleResolve('resolved')}
          disabled={loading}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 font-medium"
        >
          Resolve (Favor Buyer)
        </button>
        <button
          onClick={() => handleResolve('rejected')}
          disabled={loading}
          className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50 font-medium"
        >
          Reject (Favor Seller)
        </button>
      </div>
    </div>
  );
};

export default ArbitratorPanel;
