// Export function to emit events to specific rooms
module.exports = {
  emitToInvoice: (io, invoiceId, event, data) => {
    io.to(`invoice-${invoiceId}`).emit(event, data);
  },
  
  emitToUser: (io, userId, event, data) => {
    io.to(`user-${userId}`).emit(event, data);
  },

  // Emit to the general marketplace
  emitToMarketplace: (io, event, data) => {
    io.to('marketplace').emit(event, data);
  }
};