import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { getProduceLot } from '../utils/api';

const TimelineIcon = ({ type }) => {
  const baseClasses = "absolute w-3 h-3 rounded-full -left-1.5 border border-white";
  if (type === 'location') {
    return <div className={`${baseClasses} bg-blue-500`}></div>; // Location icon
  }
  if (type === 'transaction') {
    return <div className={`${baseClasses} bg-green-500`}></div>; // Transaction icon
  }
  return <div className={`${baseClasses} bg-gray-200`}></div>; // Default (harvest) icon
};

const ProduceHistory = () => {
  const { lotId } = useParams();
  const [lot, setLot] = useState(null);
  const [locations, setLocations] = useState([]);
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
            type: 'transaction', // <-- Add type
            id: `tx-${tx.id}`,
            lotId: tx.lot_id,
            from: tx.from_address,
            to: tx.to_address,
            quantity: tx.quantity,
            price: tx.price,
            timestamp: new Date(tx.created_at), // Keep as Date object for sorting
            transactionHash: tx.transaction_hash,
          }));
          setTransactions(decodedTransactions);

          const decodedLocations = response.data.locations.map(loc => ({
            type: 'location', // <-- Add type
            id: `loc-${loc.id}`,
            location: loc.location,
            timestamp: new Date(loc.timestamp), // Keep as Date object for sorting
            transactionHash: loc.tx_hash,
          }));
          setLocations(decodedLocations);
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

  const timelineEvents = useMemo(() => {
    if (!lot) return [];

    // Create the "Harvested" base event
    const harvestEvent = {
      type: 'harvest',
      id: 'harvest-0',
      timestamp: new Date(lot.harvest_date),
      origin: lot.origin,
    };

    // Combine transactions, locations, and the harvest event
    const allEvents = [...transactions, ...locations, harvestEvent];

    // Sort all events by timestamp, descending (most recent first)
    return allEvents.sort((a, b) => b.timestamp - a.timestamp);

  }, [lot, transactions, locations]);

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
        <h2 className="text-2xl font-bold mb-6">Transaction & Location Timeline</h2>
        <div className="relative border-l-2 border-gray-200">
          {timelineEvents.map((event) => (
            <div key={event.id} className="mb-8 ml-4">
              <TimelineIcon type={event.type} />
              <p className="text-sm text-gray-500">{event.timestamp.toLocaleString()}</p>
              
              {/* Conditional Rendering based on event type */}

              {event.type === 'transaction' && (
                <>
                  <h3 className="text-lg font-semibold text-gray-900">Transfer of {event.quantity} kg</h3>
                  <p className="text-base font-normal text-gray-600">From: {event.from}</p>
                  <p className="text-base font-normal text-gray-600">To: {event.to}</p>
                  <a href={`https://sepolia.etherscan.io/tx/${event.transactionHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    View Transaction
                  </a>
                </>
              )}

              {event.type === 'location' && (
                <>
                  <h3 className="text-lg font-semibold text-gray-900">Shipment Recieved</h3>
                  <p className="text-base font-normal text-gray-600">Location: <strong>{event.location}</strong></p>
                  <a href={`https://sepolia.etherscan.io/tx/${event.transactionHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    View Transaction
                  </a>
                </>
              )}

              {event.type === 'harvest' && (
                <>
                  <h3 className="text-lg font-semibold text-gray-900">Harvested</h3>
                  <p className="text-base font-normal text-gray-600">The produce was harvested at {event.origin}.</p>
                </>
              )}

            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProduceHistory;