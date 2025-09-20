import React, { useState } from 'react';

const CreateQuotation = ({ onSubmit, onCancel }) => {
    const [formData, setFormData] = useState({
        buyer_address: '',
        quantity: '1',
        price_per_unit: '',
        description: ''
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        // The lot_id is omitted, signaling to the backend it's a seller-initiated quote
        onSubmit(formData);
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold mb-4">Create Off-Platform Quotation</h3>
            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Buyer Wallet Address</label>
                        <input
                            type="text"
                            name="buyer_address"
                            value={formData.buyer_address}
                            onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            placeholder="0x..."
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Total Price (in MATIC)</label>
                        <input
                            type="number"
                            name="price_per_unit" // We use price_per_unit as the total since quantity is 1
                            value={formData.price_per_unit}
                            onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                            min="0.000001"
                            step="0.000001"
                        />
                    </div>
                </div>
                
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description of Goods/Service</label>
                    <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        className="w-full p-2 border border-gray-300 rounded-md"
                        rows="3"
                        required
                    />
                </div>
                
                <div className="flex justify-end space-x-3">
                    <button type="button" onClick={onCancel} className="btn-secondary">
                        Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                        Send Quotation to Buyer
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CreateQuotation;