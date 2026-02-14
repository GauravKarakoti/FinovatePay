import React, { useState } from 'react';
import axios from 'axios';

const EvidenceUpload = ({ invoiceId, onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${import.meta.env.VITE_API_URL}/dispute/${invoiceId}/evidence`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      setFile(null);
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Failed to upload evidence');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-800">Upload Evidence</h3>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select File (Image or PDF)</label>
        <input
          type="file"
          onChange={handleFileChange}
          accept="image/*,application/pdf"
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-full file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
      </div>

      {error && (
        <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={!file || loading}
        className={`px-4 py-2 rounded-md text-white font-medium ${
          !file || loading
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {loading ? 'Uploading...' : 'Upload Evidence'}
      </button>
    </div>
  );
};

export default EvidenceUpload;