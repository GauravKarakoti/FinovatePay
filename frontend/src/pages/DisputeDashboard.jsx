import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import EvidenceUpload from '../components/Dispute/EvidenceUpload';
import EvidenceList from '../components/Dispute/EvidenceList';
import DisputeTimeline from '../components/Dispute/DisputeTimeline';
import ArbitratorPanel from '../components/Dispute/ArbitratorPanel';

const DisputeDashboard = () => {
  const { invoiceId } = useParams();
  const [role, setRole] = useState(null);
  const [disputeStatus, setDisputeStatus] = useState(null); // null means no dispute record
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  // Helper to trigger re-renders of child components
  const refreshData = () => setRefreshKey(prev => prev + 1);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/auth/profile`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setRole(res.data.role);
      } catch (err) {
        console.error('Failed to fetch profile', err);
      }
    };

    const fetchStatus = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/dispute/${invoiceId}/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setDisputeStatus(res.data.status); // might be null
      } catch (err) {
        console.error('Failed to fetch status', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
    fetchStatus();

    // Socket Setup
    const socketUrl = import.meta.env.VITE_API_URL.replace('/api', '');
    const socket = io(socketUrl);

    socket.emit('join-invoice', invoiceId);
    socket.on('dispute-updated', (data) => {
      console.log('Dispute updated:', data);
      if (data.invoiceId === invoiceId) {
        refreshData();
        fetchStatus();
      }
    });

    return () => socket.disconnect();
  }, [invoiceId]);

  const handleRaiseDispute = async () => {
    if (!confirm('Are you sure you want to raise a dispute? This will alert the arbitrator.')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${import.meta.env.VITE_API_URL}/dispute/${invoiceId}/raise`,
        { reason: 'Dispute raised by user' },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      refreshData();
      // Status fetch will happen via socket or we can call it manually
      // But socket might lag slightly, so let's set status optimistically or refetch
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/dispute/${invoiceId}/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
      });
      setDisputeStatus(res.data.status);

    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Failed to raise dispute');
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dispute Resolution</h1>
          <p className="text-gray-500">Invoice #{invoiceId}</p>
        </div>

        <div>
           {disputeStatus ? (
             <span className={`px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wide ${
                disputeStatus === 'resolved' ? 'bg-green-100 text-green-800' :
                disputeStatus === 'rejected' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
             }`}>
               {disputeStatus}
             </span>
           ) : (
             <button
               onClick={handleRaiseDispute}
               className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 shadow-md transition-all font-semibold"
             >
               Raise Dispute
             </button>
           )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Evidence Management */}
        <div className="space-y-8">
          <EvidenceUpload invoiceId={invoiceId} onUploadSuccess={refreshData} />
          <EvidenceList invoiceId={invoiceId} key={`list-${refreshKey}`} />
        </div>

        {/* Right Column: Timeline & Arbitrator Actions */}
        <div className="space-y-8">
          {role === 'arbitrator' && disputeStatus === 'open' && (
            <ArbitratorPanel invoiceId={invoiceId} onResolve={refreshData} />
          )}

          <DisputeTimeline invoiceId={invoiceId} key={`timeline-${refreshKey}`} />
        </div>
      </div>
    </div>
  );
};

export default DisputeDashboard;