const { getProduceTrackingContract } = require('../config/blockchain');

exports.updateLocation = async (req, res) => {
    const { lotId, location } = req.body;

    if (!lotId || !location) {
        return res.status(400).json({ error: 'Missing lotId or location.' });
    }

    try {
        const contract = await getProduceTrackingContract();
        const tx = await contract.addLocationUpdate(lotId, location);
        await tx.wait();

        res.status(200).json({ success: true, message: 'Location updated successfully.' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: error.message || 'Internal server error.' });
    }
};