import React, { useState } from 'react';
import { createProduceLot } from '../../utils/api';

const CreateProduceLot = ({ onSubmit, onCancel, isSubmitting }) => {
  const [formData, setFormData] = useState({
    produceType: '',
    harvestDate: '',
    qualityMetrics: '',
    origin: '',
    quantity: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      harvestDate: Math.floor(new Date(formData.harvestDate).getTime() / 1000)
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-6">Register New Produce Lot</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Produce Type
            </label>
            <input
              type="text"
              name="produceType"
              value={formData.produceType}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
              required
              placeholder="e.g., Organic Tomatoes"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Harvest Date
            </label>
            <input
              type="date"
              name="harvestDate"
              value={formData.harvestDate}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Origin
            </label>
            <input
              type="text"
              name="origin"
              value={formData.origin}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
              required
              placeholder="Farm location"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity (kg)
            </label>
            <input
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
              required
              min="0"
              step="0.01"
            />
          </div>
        </div>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quality Metrics
          </label>
          <textarea
            name="qualityMetrics"
            value={formData.qualityMetrics}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
            placeholder="Organic certification, quality grades, etc."
          />
        </div>
        
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting} // Disable while submitting
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting} // Disable while submitting
            className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md hover:bg-finovate-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Processing...' : 'Register Produce'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateProduceLot;