export const generateTimelineEvents = (invoice) => {
    const events = [];
    if (!invoice) return events;

    // Event 1: Always show the creation event
    events.push({
        status: 'created',
        title: 'Invoice Created',
        description: `Invoice was created by the seller.`,
        timestamp: new Date(invoice.created_at).toLocaleString(),
    });

    // Event 2: Show deposit if status is 'deposited' or beyond
    if (['deposited', 'shipped', 'disputed', 'released'].includes(invoice.escrow_status)) {
        events.push({
            status: 'deposited',
            title: 'Funds Deposited',
            description: 'The buyer funded the escrow contract.',
            timestamp: `Tx: ${invoice.escrow_tx_hash ? `${invoice.escrow_tx_hash.substring(0, 10)}...` : 'Pending Update'}`,
        });
    }

    // NEW Event: Show shipment if status is 'shipped' or beyond
    if (['shipped', 'released'].includes(invoice.escrow_status)) {
        events.push({
            status: 'shipped',
            title: 'Shipment Confirmed',
            description: 'The seller has confirmed the goods were sent.',
            // Fallback to updated_at if a specific shipped_at doesn't exist
            timestamp: new Date(invoice.shipped_at || invoice.updated_at).toLocaleString(),
        });
    }

    // Event 3: Show dispute if status is 'disputed'
    if (invoice.escrow_status === 'disputed') {
        events.push({
            status: 'disputed',
            title: 'Dispute Raised',
            description: 'Awaiting review and resolution from the arbiter.',
            timestamp: `Case is under review`,
        });
    }

    // Event 4: Show release if status is 'released'
    if (invoice.escrow_status === 'released') {
        events.push({
            status: 'released',
            title: 'Funds Released',
            description: 'Escrow has been successfully released to the seller.',
            timestamp: `Tx: ${invoice.release_tx_hash ? `${invoice.release_tx_hash.substring(0, 10)}...` : 'N/A'}`,
        });
    }

    return events;
};