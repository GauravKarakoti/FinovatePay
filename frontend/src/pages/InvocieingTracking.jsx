import { useEffect, useState } from "react";
import { api } from "../utils/api";
import InvoiceTimeline from "../components/Invoice/InvoiceTimeline";
import { Search, Filter, ArrowUpDown, Clock, CheckCircle, AlertCircle, XCircle } from "lucide-react";

export default function InvoiceTracking() {
  const [invoices, setInvoices] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoices();
  }, []);

  useEffect(() => {
    let result = invoices;

    // Search filter
    if (search) {
      result = result.filter(inv => 
        inv.invoice_id?.toLowerCase().includes(search.toLowerCase()) ||
        inv.buyer?.toLowerCase().includes(search.toLowerCase()) ||
        inv.seller?.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter(inv => inv.status === statusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "amount") return (b.amount || 0) - (a.amount || 0);
      if (sortBy === "date") return new Date(b.created_at) - new Date(a.created_at);
      return 0;
    });

    setFiltered(result);
  }, [invoices, search, statusFilter, sortBy]);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const res = await api.get("/invoices");
      setInvoices(res.data);
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-amber-100 text-amber-700 border-amber-200",
      paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
      disputed: "bg-rose-100 text-rose-700 border-rose-200",
      cancelled: "bg-slate-100 text-slate-700 border-slate-200",
      completed: "bg-blue-100 text-blue-700 border-blue-200"
    };
    return colors[status] || colors.pending;
  };

  const getStatusIcon = (status) => {
    const icons = {
      pending: <Clock size={14} />,
      paid: <CheckCircle size={14} />,
      disputed: <AlertCircle size={14} />,
      cancelled: <XCircle size={14} />,
      completed: <CheckCircle size={14} />
    };
    return icons[status] || icons.pending;
  };

  const stats = {
    total: invoices.length,
    pending: invoices.filter(i => i.status === "pending").length,
    paid: invoices.filter(i => i.status === "paid").length,
    disputed: invoices.filter(i => i.status === "disputed").length
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Invoice Tracking</h1>
            <p className="text-slate-500 mt-1">Monitor and manage your trade finance invoices</p>
          </div>
          <button 
            onClick={fetchInvoices}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-indigo-200 active:scale-95"
          >
            Refresh Data
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total", value: stats.total, color: "bg-white" },
            { label: "Pending", value: stats.pending, color: "bg-amber-50" },
            { label: "Paid", value: stats.paid, color: "bg-emerald-50" },
            { label: "Disputed", value: stats.disputed, color: "bg-rose-50" }
          ].map((stat, idx) => (
            <div key={idx} className={`${stat.color} rounded-xl p-4 border border-slate-200 shadow-sm`}>
              <p className="text-sm font-medium text-slate-600">{stat.label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-4 md:space-y-0 md:flex md:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search invoices, buyers, sellers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
          </div>
          
          <div className="flex gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium text-slate-700 cursor-pointer appearance-none"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="disputed">Disputed</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <button
              onClick={() => setSortBy(sortBy === "date" ? "amount" : "date")}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium text-slate-700"
            >
              <ArrowUpDown size={16} />
              {sortBy === "date" ? "Date" : "Amount"}
            </button>
          </div>
        </div>

        {/* Invoice List */}
        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center border border-slate-200">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="text-slate-400" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">No invoices found</h3>
              <p className="text-slate-500 mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            filtered.map((inv) => (
              <div 
                key={inv.invoice_id} 
                className="group bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
              >
                {/* Invoice Header */}
                <div className="p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                      {inv.invoice_id?.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">#{inv.invoice_id}</h3>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(inv.status)}`}>
                          {getStatusIcon(inv.status)}
                          {inv.status?.charAt(0).toUpperCase() + inv.status?.slice(1)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                        <span>{new Date(inv.created_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="font-medium text-slate-700">{inv.token || "USDC"}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-900">
                      ${parseFloat(inv.amount || 0).toLocaleString()}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {inv.buyer?.slice(0, 6)}...{inv.buyer?.slice(-4)} → {inv.seller?.slice(0, 6)}...{inv.seller?.slice(-4)}
                    </p>
                  </div>
                </div>

                {/* Timeline */}
                <div className="p-4 md:p-6 bg-slate-50/50">
                  <InvoiceTimeline invoice={inv} compact />
                </div>

                {/* Quick Actions */}
                <div className="px-4 md:px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Clock size={14} />
                    <span>Updated {new Date(inv.updated_at || inv.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                      View Details
                    </button>
                    {inv.status === "pending" && (
                      <button className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm">
                        Pay Now
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Load More / Pagination hint */}
        {filtered.length > 0 && filtered.length < invoices.length && (
          <div className="text-center">
            <button className="px-6 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
              Load More ({invoices.length - filtered.length} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}