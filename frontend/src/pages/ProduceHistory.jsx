import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getProduceLot } from '../utils/api';

const ProduceHistory = () => {
  const { lotId } = useParams();
  const [lot, setLot] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const copyToClipboard = (textToCopy) => {
    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            alert(`Copied to clipboard: ${textToCopy}`);
        })
        .catch(err => {
            console.error('Failed to copy text: ', err);
            alert('Failed to copy.');
        });
  };

  useEffect(() => {
    const fetchProduceHistory = async () => {
      try {
        setLoading(true);
        const response = await getProduceLot(lotId);
        if (response.data.success) {
          setLot(response.data.lot);
          const decodedTransactions = response.data.transactions.map(tx => ({
            transactionId: tx.id,
            lotId: tx.lot_id,
            from: tx.from_address,
            to: tx.to_address,
            quantity: tx.quantity,
            price: tx.price,
            timestamp: new Date(tx.created_at).toLocaleString(),
            transactionHash: tx.transaction_hash,
          }));
          setTransactions(decodedTransactions);
        } else {
          setError('Produce lot not found.');
        }
      } catch (err) {
        setError('Failed to fetch produce history.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (lotId) {
      fetchProduceHistory();
    }
  }, [lotId]);

  if (loading) {
    return <div className="text-center p-8">Loading...</div>;
  }

  if (error) {
    return <div className="text-center p-8 text-red-500">{error}</div>;
  }

  if (!lot) {
    return <div className="text-center p-8">No produce lot data found.</div>;
  }

  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="bg-white rounded-lg shadow-xl p-6 mb-8">
        <h1 className="text-3xl font-bold mb-4">
          Produce History for Lot 
          <span
            className="text-blue-600 cursor-pointer hover:underline ml-2"
            onClick={() => copyToClipboard(lot.lot_id)}
            title="Click to copy Lot ID"
          >
            #{lot.lot_id}
          </span>
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p><strong>Produce Type:</strong> {lot.produce_type}</p>
            <p><strong>Origin:</strong> {lot.origin}</p>
            <p><strong>Harvest Date:</strong> {new Date(lot.harvest_date).toLocaleDateString()}</p>
          </div>
          <div>
            <p><strong>Initial Quantity:</strong> {lot.quantity} kg</p>
            <p><strong>Current Quantity:</strong> {lot.current_quantity} kg</p>
            <p><strong>Farmer:</strong> {lot.farmer_address}</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-6">Transaction Timeline</h2>
        <div className="relative border-l-2 border-gray-200">
          {transactions.map((tx, index) => (
            <div key={tx.transactionId} className="mb-8 ml-4">
              <div className="absolute w-3 h-3 bg-gray-200 rounded-full -left-1.5 border border-white"></div>
              <p className="text-sm text-gray-500">{tx.timestamp}</p>
              <h3 className="text-lg font-semibold text-gray-900">Transfer of {tx.quantity} kg</h3>
              <p className="text-base font-normal text-gray-600">From: {tx.from}</p>
              <p className="text-base font-normal text-gray-600">To: {tx.to}</p>
              <a href={`https://sepolia.etherscan.io/tx/${tx.transactionHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                View on Etherscan
              </a>
            </div>
          ))}
          <div className="mb-8 ml-4">
            <div className="absolute w-3 h-3 bg-gray-200 rounded-full -left-1.5 border border-white"></div>
            <p className="text-sm text-gray-500">{new Date(lot.harvest_date).toLocaleDateString()}</p>
            <h3 className="text-lg font-semibold text-gray-900">Harvested</h3>
            <p className="text-base font-normal text-gray-600">The produce was harvested at {lot.origin}.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProduceHistory;