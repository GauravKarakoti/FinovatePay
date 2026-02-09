import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import api from "../utils/api";
import { 
  ShieldAlert, 
  Upload, 
  FileText, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  MessageSquare, 
  Download, 
  Trash2, 
  ChevronDown, 
  ChevronUp,
  Lock,
  History,
  Paperclip,
  X
} from "lucide-react";

export default function DisputeDashboard() {
  const { invoiceId } = useParams();
  const [files, setFiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [expandedLog, setExpandedLog] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [disputeStatus, setDisputeStatus] = useState("active");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (invoiceId) {
      loadData();
    }
  }, [invoiceId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [disputeRes, filesRes] = await Promise.all([
        api.get(`/dispute/${invoiceId}`),
        api.get(`/dispute/${invoiceId}/files`)
      ]);
      setLogs(disputeRes.data.logs || []);
      setFiles(filesRes.data || []);
      setDisputeStatus(disputeRes.data.status || "active");
    } catch (err) {
      console.error("Failed to load dispute data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const uploadEvidence = async () => {
    if (!selectedFile) return;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("timestamp", new Date().toISOString());
      formData.append("type", "evidence");

      await api.post(`/dispute/${invoiceId}/evidence`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      setSelectedFile(null);
      await loadData();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = (fileId) => {
    setFileToDelete(fileId);
    setShowDeleteModal(true);
  };

  const executeDelete = async () => {
    if (!fileToDelete) return;
    try {
      await api.delete(`/dispute/${invoiceId}/files/${fileToDelete}`);
      await loadData();
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setShowDeleteModal(false);
      setFileToDelete(null);
    }
  };

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return <FileText className="text-rose-500" size={24} />;
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return <div className="text-purple-500">🖼️</div>;
    if (['doc', 'docx'].includes(ext)) return <FileText className="text-blue-500" size={24} />;
    return <Paperclip className="text-slate-400" size={24} />;
  };

  const getStatusBadge = () => {
    const configs = {
      active: { color: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle, label: "Under Review" },
      resolved: { color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle, label: "Resolved" },
      escalated: { color: "bg-rose-100 text-rose-700 border-rose-200", icon: ShieldAlert, label: "Escalated" }
    };
    const config = configs[disputeStatus] || configs.active;
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${config.color}`}>
        <config.icon size={14} />
        {config.label}
      </span>
    );
  };

  const downloadFile = (file) => {
    // Fix 2: Open file URL in new tab or trigger download
    if (file.url) {
      window.open(file.url, "_blank");
    } else if (file.download_url) {
      window.open(file.download_url, "_blank");
    } else {
      // Fallback: construct download URL from API
      const downloadUrl = `${api.defaults.baseURL}/dispute/${invoiceId}/files/${file.id}/download`;
      window.open(downloadUrl, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-rose-100 rounded-lg">
                  <ShieldAlert className="text-rose-600" size={24} />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">Dispute Center</h1>
                  <p className="text-slate-500 text-sm">Invoice #{invoiceId}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {getStatusBadge()}
              <button 
                onClick={loadData}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <Clock size={20} className="text-slate-400" />
              </button>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="mt-6 flex items-center gap-2 text-sm overflow-x-auto">
            {['Filed', 'Under Review', 'Evidence Collection', 'Resolution'].map((step, idx) => {
              const isActive = idx <= 2;
              const isCurrent = idx === 2;
              return (
                <div key={step} className="flex items-center gap-2 shrink-0">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium whitespace-nowrap ${
                    isCurrent ? 'bg-indigo-600 text-white' : 
                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {isActive && !isCurrent && <CheckCircle size={14} />}
                    {isCurrent && <Clock size={14} />}
                    <span>{step}</span>
                  </div>
                  {idx < 3 && <div className={`w-8 h-0.5 shrink-0 ${isActive ? 'bg-indigo-300' : 'bg-slate-200'}`}></div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          
          {/* Left Column - Upload & Files */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Upload Zone */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Upload size={20} className="text-indigo-600" />
                Submit Evidence
              </h3>

              <div 
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400'
                } ${selectedFile ? 'bg-emerald-50 border-emerald-300' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  ref={fileInputRef}
                  type="file" 
                  className="hidden" 
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                />
                
                {selectedFile ? (
                  <div className="space-y-3">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle className="text-emerald-600" size={32} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{selectedFile.name}</p>
                      <p className="text-sm text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <div className="flex gap-2 justify-center">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                        className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Remove
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); uploadEvidence(); }}
                        disabled={uploading}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {uploading ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <Upload size={18} />
                        )}
                        {uploading ? 'Uploading...' : 'Upload Now'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 cursor-pointer">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                      <Upload className="text-slate-400" size={32} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">Drop files here or click to browse</p>
                      <p className="text-sm text-slate-500 mt-1">PDF, Word, or Images up to 10MB</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
                <Lock size={14} />
                <span>All uploads are encrypted and tamper-proof on blockchain</span>
              </div>
            </div>

            {/* Evidence List */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Paperclip size={20} className="text-indigo-600" />
                  Submitted Evidence
                </h3>
                <span className="text-sm text-slate-500">{files.length} files</span>
              </div>

              {files.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <FileText size={24} />
                  </div>
                  <p>No evidence submitted yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {files.map((file) => (
                    <div 
                      key={file.id} 
                      className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-white rounded-lg shadow-sm shrink-0">
                          {getFileIcon(file.filename)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 text-sm truncate">{file.filename}</p>
                          <p className="text-xs text-slate-500">
                            Uploaded {new Date(file.created_at).toLocaleDateString()} • {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button 
                          onClick={() => downloadFile(file)}
                          className="p-2 hover:bg-white rounded-lg transition-colors text-slate-600"
                          title="Download"
                        >
                          <Download size={18} />
                        </button>
                        <button 
                          onClick={() => confirmDelete(file.id)}
                          className="p-2 hover:bg-rose-100 rounded-lg transition-colors text-rose-600"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Audit Logs */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <History size={20} className="text-indigo-600" />
                Audit Trail
              </h3>

              <div className="space-y-4 relative">
                <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-slate-200"></div>
                
                {logs.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No activity recorded</p>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="relative pl-8">
                      <div className={`absolute left-0 top-1.5 w-4 h-4 rounded-full border-2 ${
                        idx === 0 ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
                      }`}></div>
                      
                      <div 
                        className="bg-slate-50 rounded-lg p-3 cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => setExpandedLog(expandedLog === idx ? null : idx)}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{log.action || log.message}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {new Date(log.timestamp || log.created_at).toLocaleString()}
                            </p>
                          </div>
                          {expandedLog === idx ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                        </div>
                        
                        {expandedLog === idx && log.details && (
                          <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                            {Object.entries(log.details).map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span className="capitalize">{key.replace('_', ' ')}:</span>
                                <span className="font-mono text-slate-900">{value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Help Card */}
            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 text-white">
              <div className="flex items-start gap-3">
                <MessageSquare className="shrink-0" size={24} />
                <div>
                  <h4 className="font-semibold mb-1">Need Help?</h4>
                  <p className="text-sm text-indigo-100 mb-3">
                    Our dispute resolution team is available 24/7 to assist you.
                  </p>
                  <button className="text-sm font-medium bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors">
                    Contact Arbitrator
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fix 3: Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-rose-100 rounded-full">
                <AlertTriangle className="text-rose-600" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Remove Evidence?</h3>
            </div>
            <p className="text-slate-600 mb-6">
              This action cannot be undone. The file will be permanently removed from this dispute.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeDelete}
                className="flex-1 px-4 py-2 text-white bg-rose-600 hover:bg-rose-700 rounded-lg font-medium transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}