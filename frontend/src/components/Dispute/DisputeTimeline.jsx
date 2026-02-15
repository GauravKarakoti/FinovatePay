import React, { useEffect, useState } from 'react';
import axios from 'axios';

const DisputeTimeline = ({ invoiceId }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/dispute/${invoiceId}/logs`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setLogs(res.data);
      } catch (err) {
        console.error('Failed to load logs', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [invoiceId]);

  if (loading) return <div className="text-gray-500 py-4">Loading timeline...</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-800">Dispute Timeline</h3>
      {logs.length === 0 ? (
        <p className="text-gray-500 italic">No activity yet.</p>
      ) : (
        <div className="relative border-l-2 border-gray-200 ml-3">
          {logs.map((log) => (
            <div key={log.id} className="mb-6 ml-6 relative">
              <span className="absolute -left-8 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 ring-4 ring-white"></span>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500 mb-1">{new Date(log.timestamp).toLocaleString()}</span>
                <h4 className="text-md font-semibold text-gray-900">{log.action}</h4>
                <p className="text-sm text-gray-600 mt-1">{log.notes}</p>
                <span className="text-xs text-gray-400 mt-1">by {log.performed_by}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DisputeTimeline;