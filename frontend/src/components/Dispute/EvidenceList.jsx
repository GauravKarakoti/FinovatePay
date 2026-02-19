import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';


const EvidenceList = ({ invoiceId }) => {
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvidence = async () => {
      try {
        const res = await api.get(`/dispute/${invoiceId}/evidence`);
        setEvidence(res.data);
      } catch (err) {
        console.error('Failed to load evidence', err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvidence();
  }, [invoiceId]);


  if (loading) return <div className="text-gray-500 text-center py-4">Loading evidence...</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-800">Evidence Files</h3>
      {evidence.length === 0 ? (
        <p className="text-gray-500 italic">No evidence uploaded yet.</p>
      ) : (
        <ul className="space-y-4">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">{item.file_name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Uploaded by <span className="font-semibold">{item.uploaded_by}</span> on {new Date(item.created_at).toLocaleString()}
                </p>
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
