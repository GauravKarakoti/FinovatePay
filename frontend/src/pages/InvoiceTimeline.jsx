import { useEffect, useState } from "react";
import { getEscrowContract } from "../../utils/web3";
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  XCircle, 
  ArrowRight,
  Shield,
  Wallet,
  Package,
  Scale,
  Ban
} from "lucide-react";

const stateMap = [
  "Created",
  "Deposited",
  "Released",
  "Disputed",
  "Cancelled"
];

const stateConfig = {
  Created: {
    icon: Circle,
    color: "bg-slate-100 text-slate-600 border-slate-300",
    activeColor: "bg-indigo-600 text-white border-indigo-600",
    label: "Created",
    description: "Invoice issued"
  },
  Deposited: {
    icon: Wallet,
    color: "bg-amber-50 text-amber-600 border-amber-300",
    activeColor: "bg-amber-500 text-white border-amber-500",
    label: "Funded",
    description: "Buyer deposited"
  },
  Released: {
    icon: CheckCircle2,
    color: "bg-emerald-50 text-emerald-600 border-emerald-300",
    activeColor: "bg-emerald-500 text-white border-emerald-500",
    label: "Completed",
    description: "Payment released"
  },
  Disputed: {
    icon: Scale,
    color: "bg-rose-50 text-rose-600 border-rose-300",
    activeColor: "bg-rose-500 text-white border-rose-500",
    label: "Disputed",
    description: "Under review"
  },
  Cancelled: {
    icon: Ban,
    color: "bg-slate-50 text-slate-500 border-slate-300",
    activeColor: "bg-slate-600 text-white border-slate-600",
    label: "Cancelled",
    description: "Transaction void"
  }
};

export default function InvoiceTimeline({ invoice, compact = false }) {
  const [onchainState, setOnchainState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    loadState();
  }, [invoice.invoice_id]);

  const loadState = async () => {
    try {
      setLoading(true);
      const escrow = await getEscrowContract();
      const data = await escrow.escrows(invoice.invoice_id);
      
      const stateIndex = Number(data.state);
      const stateName = stateMap[stateIndex];
      
      setOnchainState(stateName);
      setCurrentStep(stateIndex);
    } catch (err) {
      console.error("Failed to load escrow state:", err);
      setOnchainState("Error");
    } finally {
      setLoading(false);
    }
  };

  const getStepStatus = (stepIndex) => {
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "current";
    return "pending";
  };

  const renderCompactView = () => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 animate-pulse">
          <div className="w-4 h-4 bg-slate-200 rounded-full"></div>
          <div className="h-3 bg-slate-200 rounded w-20"></div>
        </div>
      );
    }

    const config = stateConfig[onchainState] || stateConfig.Created;
    const Icon = config.icon;

    return (
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.activeColor}`}>
          <Icon size={12} />
          {config.label}
        </span>
        <span className="text-xs text-slate-500">{config.description}</span>
      </div>
    );
  };

  const renderFullView = () => {
    if (loading) {
      return (
        <div className="space-y-4 animate-pulse">
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex-1 h-2 bg-slate-200 rounded-full"></div>
            ))}
          </div>
        </div>
      );
    }

    const config = stateConfig[onchainState] || stateConfig.Created;

    return (
      <div className="space-y-6">
        {/* Header Card */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                <Shield size={14} />
                <span>Blockchain Verified</span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight">
                Invoice #{invoice.invoice_id?.slice(0, 8)}...
              </h3>
              <p className="text-slate-400 mt-1 text-sm">
                {new Date(invoice.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            </div>
            <div className={`px-4 py-2 rounded-xl border-2 ${config.activeColor} shadow-lg`}>
              <div className="flex items-center gap-2">
                <config.icon size={18} />
                <span className="font-semibold">{config.label}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4 text-center">
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
              <p className="text-2xl font-bold">${parseFloat(invoice.amount).toLocaleString()}</p>
              <p className="text-xs text-slate-400 uppercase tracking-wider mt-1">Amount</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
              <p className="text-sm font-mono">{invoice.buyer?.slice(0, 6)}...{invoice.buyer?.slice(-4)}</p>
              <p className="text-xs text-slate-400 uppercase tracking-wider mt-1">Buyer</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
              <p className="text-sm font-mono">{invoice.seller?.slice(0, 6)}...{invoice.seller?.slice(-4)}</p>
              <p className="text-xs text-slate-400 uppercase tracking-wider mt-1">Seller</p>
            </div>
          </div>
        </div>

        {/* Progress Timeline */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <h4 className="font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <Clock size={18} className="text-indigo-600" />
            Transaction Progress
          </h4>

          <div className="relative">
            {/* Progress Bar Background */}
            <div className="absolute top-5 left-0 right-0 h-1 bg-slate-200 rounded-full"></div>
            
            {/* Active Progress */}
            <div 
              className="absolute top-5 left-0 h-1 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700"
              style={{ width: `${(currentStep / (stateMap.length - 2)) * 100}%` }}
            ></div>

            {/* Steps */}
            <div className="relative flex justify-between">
              {stateMap.slice(0, 4).map((state, index) => {
                const status = getStepStatus(index);
                const stepConfig = stateConfig[state];
                const Icon = stepConfig.icon;
                const isCompleted = status === "completed";
                const isCurrent = status === "current";

                return (
                  <div key={state} className="flex flex-col items-center">
                    <div 
                      className={`
                        w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 z-10
                        ${isCompleted ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-200' : 
                          isCurrent ? stepConfig.activeColor + ' shadow-lg scale-110' : 
                          'bg-white border-slate-300 text-slate-400'}
                      `}
                    >
                      {isCompleted ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                    </div>
                    <div className="mt-3 text-center">
                      <p className={`text-xs font-semibold ${isCurrent ? 'text-slate-900' : 'text-slate-500'}`}>
                        {stepConfig.label}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5 max-w-[80px] leading-tight">
                        {stepConfig.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current Status Detail */}
          <div className={`mt-6 p-4 rounded-xl border ${config.color}`}>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${config.activeColor}`}>
                <config.icon size={20} />
              </div>
              <div>
                <h5 className="font-semibold text-sm">{config.label}</h5>
                <p className="text-sm mt-1 opacity-80">
                  {onchainState === "Created" && "Waiting for buyer to deposit funds into escrow."}
                  {onchainState === "Deposited" && "Funds secured in escrow. Awaiting delivery confirmation."}
                  {onchainState === "Released" && "Payment successfully released to seller. Transaction complete."}
                  {onchainState === "Disputed" && "Dispute raised. Arbitrator review in progress."}
                  {onchainState === "Cancelled" && "Transaction cancelled. Funds returned to buyer."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button 
            onClick={loadState}
            className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Clock size={18} />
            Refresh Status
          </button>
          {onchainState === "Created" && (
            <button className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-indigo-200 flex items-center justify-center gap-2">
              <Wallet size={18} />
              Deposit Now
            </button>
          )}
          {onchainState === "Deposited" && (
            <button className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-emerald-200 flex items-center justify-center gap-2">
              <Package size={18} />
              Confirm Receipt
            </button>
          )}
        </div>
      </div>
    );
  };

  if (compact) {
    return renderCompactView();
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {renderFullView()}
    </div>
  );
}