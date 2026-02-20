import React from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CSVLink } from 'react-csv';
import PropTypes from 'prop-types';

const ExportTransactions = ({ invoices }) => {
  
  const generatePDF = () => {
    const doc = new jsPDF();

    // 1. Add Title & Header
    doc.setFontSize(18);
    doc.text("FinovatePay - Transaction Report", 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 30);

    // 2. Format Data for Table
    const tableColumn = ["ID", "Client", "Produce", "Amount", "Status", "Date"];
    const tableRows = invoices.map(invoice => [
      (invoice.invoice_id || "").substring(0, 8) + "...",
      invoice.client || "N/A",
      invoice.produce_type || "N/A",
      `${invoice.amount || 0} MATIC`,
      invoice.status || "Pending",
      new Date(invoice.created_at || Date.now()).toLocaleDateString()
    ]);

    // 3. Generate Table
    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 40,
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [22, 160, 133] } // Brand Green
    });

    // 4. Save
    doc.save("FinovatePay_Invoices.pdf");
  };

  const csvHeaders = [
    { label: "Invoice ID", key: "invoice_id" },
    { label: "Client", key: "client" },
    { label: "Produce", key: "produce_type" },
    { label: "Amount", key: "amount" },
    { label: "Status", key: "status" },
    { label: "Origin", key: "origin" },
    { label: "Date", key: "created_at" }
  ];

  return (
    <div className="flex gap-2">
      <CSVLink
        data={invoices}
        headers={csvHeaders}
        filename={"FinovatePay_Transactions.csv"}
        className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700 text-sm font-medium transition-colors flex items-center gap-2"
      >
        <span>📊</span> Export CSV
      </CSVLink>

      <button
        onClick={generatePDF}
        className="bg-red-600 text-white px-4 py-2 rounded shadow hover:bg-red-700 text-sm font-medium transition-colors flex items-center gap-2"
      >
        <span>📄</span> Export PDF
      </button>
    </div>
  );
};

ExportTransactions.propTypes = {
  invoices: PropTypes.array.isRequired
};

export default ExportTransactions;