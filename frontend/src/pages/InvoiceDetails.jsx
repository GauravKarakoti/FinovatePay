import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import StatusTimeline from '../components/StatusTimeline';
import { jsPDF } from "jspdf";
// 1. IMPORT THE NEW COMPONENT
import EarlyPaymentCard from '../components/EarlyPaymentCard'; 

const InvoiceDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // Mock data (In real app, fetch this from API using the 'id')
  const invoiceData = {
    id: id,
    client: "Acme Corp",
    amount: "15,000 USDC",
    status: "funded",
    dueDate: "2026-03-01"
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text(`Invoice #${invoiceData.id}`, 20, 20);
    doc.setFontSize(12);
    doc.text(`Client: ${invoiceData.client}`, 20, 40);
    doc.text(`Amount: ${invoiceData.amount}`, 20, 50);
    doc.text(`Due Date: ${invoiceData.dueDate}`, 20, 60);
    doc.text(`Status: ${invoiceData.status.toUpperCase()}`, 20, 70);
    doc.setLineWidth(0.5);
    doc.line(20, 90, 100, 90);
    doc.text("Digitally Signed by FinovatePay", 20, 95);
    doc.save(`Invoice_${invoiceData.id}.pdf`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <button 
          onClick={() => navigate(-1)} 
          className="mb-6 flex items-center text-gray-600 hover:text-blue-600 transition-colors"
        >
          <span className="mr-2">&larr;</span> Back to Dashboard
        </button>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
          <div className="p-8 border-b border-gray-100 bg-white">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Invoice #{invoiceData.id}</h1>
                <p className="text-gray-500 mt-1">Client: {invoiceData.client}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-600">{invoiceData.amount}</p>
                <p className="text-sm text-gray-400">Due: {invoiceData.dueDate}</p>
              </div>
            </div>
          </div>

          <div className="p-8 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-6">Processing Status</h3>
            <StatusTimeline currentStatus={invoiceData.status} />
          </div>

          {/* 2. INSERT THE EARLY PAYMENT CARD HERE 
            We pass the 'id' so the component knows which invoice to check.
          */}
          <div className="px-8 pt-4">
             <EarlyPaymentCard invoiceId={id} />
          </div>

          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <h4 className="font-semibold text-blue-800 mb-2">Smart Contract Escrow</h4>
              <p className="text-sm text-blue-600">Contract Address: 0x71C...9A21</p>
              <p className="text-sm text-blue-600 mt-1">Funds Locked: Yes</p>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="font-semibold text-gray-700 mb-2">Documents</h4>
              <button 
                onClick={handleDownloadPDF}
                className="text-sm text-blue-500 hover:underline flex items-center mt-2"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Signed Invoice (PDF)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetails;