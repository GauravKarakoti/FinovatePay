import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getProduceLot } from '../utils/api';

const ProduceHistory = () => {
  const { lotId } = useParams();
  const [produceLot, setProduceLot] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProduceData = async () => {
      try {
        const response = await getProduceLot(lotId);
        setProduceLot(response.data.lot);
        setTransactions(response.data.transactions || []);
      } catch (error) {
        console.error('Error loading produce data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadProduceData();
  }, [lotId]);

  if (loading) {
    return <div className="container mx-auto p-4 text-center">Loading produce history...</div>;
  }

  if (!produceLot) {
    return <div className="container mx-auto p-4 text-center">Produce lot not found.</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h1 className="text-2xl font-bold mb-4">Produce Traceability for Lot #{produceLot.lot_id}</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <h2 className="text-xl font-semibold mb-3">Product Information</h2>
            <div className="space-y-2">
              {/* FIX: Use snake_case properties from the database */}
              <p><strong>Produce Type:</strong> {produceLot.produce_type}</p>
              <p><strong>Origin:</strong> {produceLot.origin}</p>
              <p><strong>Harvest Date:</strong> {new Date(produceLot.harvest_date).toLocaleDateString()}</p>
              <p><strong>Registered Quantity:</strong> {produceLot.quantity} kg</p>
              <p><strong>Quality Metrics:</strong> {produceLot.quality_metrics}</p>
            </div>
          </div>
          
          <div>
            <h2 className="text-xl font-semibold mb-3">Original Farmer</h2>
            <p className="text-sm bg-gray-100 p-3 rounded break-all">
              {/* FIX: Use farmer_address from the database */}
              {produceLot.farmer_address}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Supply Chain History</h2>
        
        {transactions.length > 0 ? (
          <div className="space-y-4">
            {transactions.map((transaction, index) => (
              <div key={transaction.id} className="border-l-4 border-blue-500 pl-4 py-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Transaction #{transactions.length - index}</p>
                    <p className="text-sm text-gray-600 break-all">
                      From: {transaction.from_address} → To: {transaction.to_address}
                    </p>
                    <p className="text-sm text-gray-600">
                      Quantity: {transaction.quantity} kg • Price: ${transaction.price} 
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(transaction.created_at).toLocaleString()}
                    </p>
                  </div>
                  <a 
                    href={`https://amoy.polygonscan.com/tx/${transaction.transaction_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 text-sm ml-4"
                  >
                    View on Explorer
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600">No transfer transactions recorded for this lot yet.</p>
        )}
      </div>
    </div>
  );
};

export default ProduceHistory;