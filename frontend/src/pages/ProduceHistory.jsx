import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import PropTypes from 'prop-types';
import { getProduceLot } from '../utils/api';
import { toast } from 'sonner';

// --- Reusable UI Components ---

const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" role="status">
      <span className="sr-only">Loading history...</span>
    </div>
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="text-center py-20 px-4">
    <div className="text-6xl mb-4">⚠️</div>
    <h3 className="text-xl font-bold text-gray-900 mb-2">Unable to Load History</h3>
    <p className="text-gray-500 mb-6 max-w-md mx-auto">{message}</p>
    {onRetry && (
      <button 
        onClick={onRetry}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
      >
        Try Again
      </button>
    )}
  </div>
);

ErrorState.propTypes = {
  message: PropTypes.string.isRequired,
  onRetry: PropTypes.func
};

const CopyButton = ({ text, label = "Copy ID", className = "" }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
      toast.error('Failed to copy');
    }
  }, [text, label]);

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${className} ${
        copied 
          ? 'bg-green-100 text-green-700' 
          : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
      }`}
      title={copied ? 'Copied!' : `Copy ${label}`}
    >
      <i className={`fa-regular ${copied ? 'fa-check' : 'fa-copy'}`}></i>
      {copied ? 'Copied!' : label}
    </button>
  );
};

CopyButton.propTypes = {
  text: PropTypes.string.isRequired,
  label: PropTypes.string,
  className: PropTypes.string
};

const TimelineIcon = ({ type }) => {
  const configs = {
    harvest: { bg: 'bg-amber-500', icon: 'fa-seedling', label: 'Harvest' },
    location: { bg: 'bg-blue-500', icon: 'fa-location-dot', label: 'Location' },
    transaction: { bg: 'bg-green-500', icon: 'fa-exchange-alt', label: 'Transaction' }
  };

  const config = configs[type] || configs.harvest;

  return (
    <div 
      className={`absolute -left-3 w-6 h-6 rounded-full border-2 border-white shadow-sm flex items-center justify-center ${config.bg}`}
      title={config.label}
    >
      <i className={`fa-solid ${config.icon} text-white text-xs`}></i>
    </div>
  );
};

TimelineIcon.propTypes = {
  type: PropTypes.oneOf(['harvest', 'location', 'transaction']).isRequired
};

const DetailItem = ({ label, value, isMono = false }) => (
  <div className="space-y-1">
    <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</dt>
    <dd className={`text-sm font-medium text-gray-900 ${isMono ? 'font-mono break-all' : ''}`}>
      {value || '—'}
    </dd>
  </div>
);

DetailItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  isMono: PropTypes.bool
};

// --- Feature Components ---

const TimelineEvent = ({ event }) => {
  const formatDate = (date) => date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const renderContent = () => {
    switch (event.type) {
      case 'transaction':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">
                Transfer of {event.quantity} kg
              </h3>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                SALE
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500 text-xs block">From</span>
                <span className="font-mono text-xs break-all text-gray-700">{event.from}</span>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500 text-xs block">To</span>
                <span className="font-mono text-xs break-all text-gray-700">{event.to}</span>
              </div>
            </div>
            {event.transactionHash && (
              <a 
                href={`https://sepolia.etherscan.io/tx/${event.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline mt-1"
              >
                View on Etherscan <i className="fa-solid fa-external-link-alt text-xs"></i>
              </a>
            )}
          </div>
        );

      case 'location':
        return (
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-900">Shipment Received</h3>
            <div className="flex items-center gap-2 text-gray-600 bg-blue-50 p-3 rounded-lg">
              <i className="fa-solid fa-location-dot text-blue-500"></i>
              <span className="font-medium">{event.location}</span>
            </div>
            {event.transactionHash && (
              <a 
                href={`https://sepolia.etherscan.io/tx/${event.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                View Transaction <i className="fa-solid fa-external-link-alt text-xs"></i>
              </a>
            )}
          </div>
        );

      case 'harvest':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Harvested</h3>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                ORIGIN
              </span>
            </div>
            <p className="text-gray-600">
              Produce harvested at <strong className="text-gray-900">{event.origin}</strong>
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="relative pl-8 pb-8 last:pb-0">
      <TimelineIcon type={event.type} />
      <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
        <time className="text-xs font-semibold text-gray-400 min-w-[140px] pt-1">
          {formatDate(event.timestamp)}
        </time>
        <div className="flex-1 bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

TimelineEvent.propTypes = {
  event: PropTypes.shape({
    type: PropTypes.string.isRequired,
    timestamp: PropTypes.instanceOf(Date).isRequired,
    quantity: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    from: PropTypes.string,
    to: PropTypes.string,
    location: PropTypes.string,
    origin: PropTypes.string,
    transactionHash: PropTypes.string
  }).isRequired
};

const LotHeader = ({ lot }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8 mb-8">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div className="flex items-start md:items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
          <i className="fa-solid fa-wheat-awn text-2xl"></i>
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Produce History
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-gray-500 font-mono text-sm">Lot #{lot.lot_id}</span>
            <CopyButton text={lot.lot_id} label="Lot ID" className="scale-90" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
          {lot.current_quantity} kg available
        </span>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-gray-50 rounded-xl p-6">
      <DetailItem label="Produce Type" value={lot.produce_type} />
      <DetailItem label="Origin" value={lot.origin} />
      <DetailItem label="Harvest Date" value={new Date(lot.harvest_date).toLocaleDateString()} />
      <DetailItem label="Initial Quantity" value={`${lot.quantity} kg`} />
      <DetailItem label="Current Quantity" value={`${lot.current_quantity} kg`} />
      <DetailItem label="Farmer Address" value={lot.farmer_address} isMono />
    </div>
  </div>
);

LotHeader.propTypes = {
  lot: PropTypes.object.isRequired
};

// --- Main Component ---

const ProduceHistory = () => {
  const { lotId } = useParams();
  const [lot, setLot] = useState(null);
  const [locations, setLocations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProduceHistory = useCallback(async () => {
    if (!lotId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await getProduceLot(lotId);
      
      if (!response.data.success) {
        setError('Produce lot not found');
        return;
      }

      const data = response.data;
      setLot(data.lot);

      // Transform transactions
      const decodedTransactions = (data.transactions || []).map(tx => ({
        type: 'transaction',
        id: `tx-${tx.id}`,
        lotId: tx.lot_id,
        from: tx.from_address,
        to: tx.to_address,
        quantity: tx.quantity,
        price: tx.price,
        timestamp: new Date(tx.created_at),
        transactionHash: tx.transaction_hash,
      }));

      // Transform locations
      const decodedLocations = (data.locations || []).map(loc => ({
        type: 'location',
        id: `loc-${loc.id}`,
        location: loc.location,
        timestamp: new Date(loc.timestamp),
        transactionHash: loc.tx_hash,
      }));

      setTransactions(decodedTransactions);
      setLocations(decodedLocations);
    } catch (err) {
      console.error('Failed to fetch produce history:', err);
      setError('Failed to fetch produce history. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    fetchProduceHistory();
  }, [fetchProduceHistory]);

  // Memoized timeline events sorted by date (newest first)
  const timelineEvents = useMemo(() => {
    if (!lot) return [];

    const harvestEvent = {
      type: 'harvest',
      id: 'harvest-0',
      timestamp: new Date(lot.harvest_date),
      origin: lot.origin,
    };

    return [...transactions, ...locations, harvestEvent]
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [lot, transactions, locations]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={fetchProduceHistory} />;
  if (!lot) return <ErrorState message="No produce lot data found" />;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto animate-fade-in">
        <LotHeader lot={lot} />
        
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Supply Chain Timeline</h2>
              <p className="text-gray-500 mt-1">
                Complete history from harvest to current location
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span>Harvest</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span>Location</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>Transfer</span>
              </div>
            </div>
          </div>

          <div className="relative border-l-2 border-gray-200 ml-3 sm:ml-0">
            {timelineEvents.length > 0 ? (
              timelineEvents.map((event) => (
                <TimelineEvent 
                  key={event.id} 
                  event={event} 
                />
              ))
            ) : (
              <div className="pl-8 py-8 text-center text-gray-500">
                <i className="fa-regular fa-clock text-4xl mb-3 block"></i>
                No history events recorded yet
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-400">
          <p>Powered by Blockchain Verification</p>
        </div>
      </div>
    </div>
  );
};

export default ProduceHistory;