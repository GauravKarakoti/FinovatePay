
import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../utils/api';

const EvidenceList = ({ invoiceId }) => {
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [participantImageLoading, setParticipantImageLoading] = useState({});
  const timeoutsRef = useRef({});

  useEffect(() => {
    const fetchEvidence = async () => {
      try {
        const res = await api.get(`/dispute/${invoiceId}/evidence`);
        setEvidence(res.data);

        // Initialize loading state for participant images
        const loadingState = {};
        res.data.forEach(item => {
          if (item.participant_id) {
            loadingState[item.participant_id] = true;
            // Set a timeout to force loading to false after 5 seconds
            timeoutsRef.current[item.participant_id] = setTimeout(() => {
              setParticipantImageLoading(prev => ({
                ...prev,
                [item.participant_id]: false
              }));
              delete timeoutsRef.current[item.participant_id];
            }, 5000);
          }
        });
        setParticipantImageLoading(loadingState);
      } catch (err) {
        console.error('Failed to load evidence', err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvidence();

    // Cleanup timeouts on unmount
    return () => {
      Object.values(timeoutsRef.current).forEach(clearTimeout);
      timeoutsRef.current = {};
    };
  }, [invoiceId]);


  if (loading) return <div className="text-gray-500 text-center py-4">Loading evidence...</div>;

  // Function to handle image load
  const handleImageLoad = (participantId) => {
    setParticipantImageLoading(prev => ({
      ...prev,
      [participantId]: false
    }));
    if (timeoutsRef.current[participantId]) {
      clearTimeout(timeoutsRef.current[participantId]);
      delete timeoutsRef.current[participantId];
    }
  };

  // Function to handle image error
  const handleImageError = (participantId) => {
    setParticipantImageLoading(prev => ({
      ...prev,
      [participantId]: false
    }));
    if (timeoutsRef.current[participantId]) {
      clearTimeout(timeoutsRef.current[participantId]);
      delete timeoutsRef.current[participantId];
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-800">Evidence Files</h3>
      {evidence.length === 0 ? (
        <p className="text-gray-500 italic">No evidence uploaded yet.</p>
      ) : (
        <ul className="space-y-4">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                {item.participant_id && (
                  <div className="relative">
                    {participantImageLoading[item.participant_id] && (
                      <div className="w-10 h-10 bg-gray-200 animate-pulse rounded-full"></div>
                    )}
                    <img
                      src={`${import.meta.env.VITE_API_URL.replace('/api', '')}/uploads/participants/${item.participant_id}.jpg`}
                      alt="Participant"
                      className={`w-10 h-10 rounded-full object-cover ${participantImageLoading[item.participant_id] ? 'hidden' : 'block'}`}
                      onLoad={() => handleImageLoad(item.participant_id)}
                      onError={() => handleImageError(item.participant_id)}
                    />
                  </div>
                )}
                <div>
                  <p className="font-medium text-gray-900">{item.file_name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Uploaded by <span className="font-semibold">{item.uploaded_by}</span> on {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <a
                href={`${import.meta.env.VITE_API_URL.replace('/api', '')}${item.file_url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200 transition-colors"
              >
                View
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EvidenceList;
